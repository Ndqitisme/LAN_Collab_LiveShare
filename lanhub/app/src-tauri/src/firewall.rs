//! The Windows Firewall helper of the hub settings screen. It reads the inbound rules with
//! `netsh advfirewall firewall show rule` (read-only) and fixes what keeps the hub's TCP port or the UDP
//! discovery port closed with one elevated `netsh -f <script>`, so the user answers one UAC prompt for the
//! whole batch. It runs only when the user asks, and never adds a rule that is already there.

use std::path::Path;

use lanhub_core::config;
use lanhub_core::diagnose::{self, FirewallRule};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Protocol {
    #[serde(rename = "TCP")]
    Tcp,
    #[serde(rename = "UDP")]
    Udp,
}

impl Protocol {
    pub fn as_str(self) -> &'static str {
        match self {
            Protocol::Tcp => "TCP",
            Protocol::Udp => "UDP",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum RuleState {
    /// An enabled inbound rule lets the traffic in.
    Present { rule: String },
    /// No rule lets it in.
    Missing,
    /// The rule this helper adds is there but does not let the traffic in (turned off or edited).
    Disabled,
    /// An enabled inbound block rule wins over every allow rule. `program` when the rule is limited to this
    /// app, as Windows creates it when its own firewall prompt is cancelled; the helper removes only those.
    #[serde(rename_all = "camelCase")]
    Blocked { rule: String, program: bool },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleCheck {
    pub protocol: Protocol,
    pub port: u16,
    pub name: String,
    pub state: RuleState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub rules: Vec<RuleCheck>,
    /// The `netsh` commands, without the leading `netsh`, that fix what can be fixed. Empty when nothing
    /// needs doing.
    pub commands: Vec<String>,
    /// False when the listing is not in English: only the rules this helper names are recognised then.
    pub english: bool,
}

/// The name of the rule this helper adds, the form `lanhub-cli --diagnose` suggests.
pub fn rule_name(protocol: Protocol, port: u16) -> String {
    format!("LAN Hub {} {port}", protocol.as_str())
}

/// The rule names of a `show rule` listing in any display language: every rule starts with a
/// `<label>: <name>` line followed by a line of dashes.
pub fn rule_names(text: &str) -> Vec<String> {
    let lines: Vec<&str> = text.lines().collect();
    lines
        .windows(2)
        .filter(|w| {
            let next = w[1].trim();
            next.len() >= 10 && next.bytes().all(|b| b == b'-')
        })
        .filter_map(|w| w[0].split_once(':').map(|(_, v)| v.trim().to_owned()))
        .collect()
}

fn add_rule(protocol: Protocol, port: u16) -> String {
    format!(
        "advfirewall firewall add rule name=\"{}\" dir=in action=allow protocol={} localport={port}",
        rule_name(protocol, port),
        protocol.as_str()
    )
}

/// Judges each wanted port against the listing of `netsh advfirewall firewall show rule name=all dir=in
/// verbose` and lists the commands that open it. `exe` is this app, for rules limited to a program.
pub fn judge(text: &str, wants: &[(Protocol, u16)], exe: &Path) -> Report {
    let rules = diagnose::parse_rules(text);
    let english = !rules.is_empty();
    let names = rule_names(text);
    let mut checks = Vec::new();
    let mut commands: Vec<String> = Vec::new();
    for &(protocol, port) in wants {
        let name = rule_name(protocol, port);
        let covering = |r: &&FirewallRule| diagnose::covers(r, protocol.as_str(), port, exe);
        let ours = |r: &&FirewallRule| r.name == name;
        let allow = rules.iter().filter(|r| r.allow).find(covering);
        let fix_allow = |commands: &mut Vec<String>| {
            if rules.iter().any(|r| ours(&r)) {
                commands.push(format!(
                    "advfirewall firewall set rule name=\"{name}\" dir=in new enable=yes action=allow protocol={} localport={port}",
                    protocol.as_str()
                ));
            } else {
                commands.push(add_rule(protocol, port));
            }
        };
        let state = if !english {
            if names.contains(&name) {
                RuleState::Present { rule: name.clone() }
            } else {
                commands.push(add_rule(protocol, port));
                RuleState::Missing
            }
        } else if let Some(block) = rules.iter().filter(|r| !r.allow).find(covering) {
            let program = block
                .program
                .as_deref()
                .is_some_and(|p| config::same_path(Path::new(p), exe));
            if program {
                commands.push(format!(
                    "advfirewall firewall delete rule name=\"{}\" dir=in program=\"{}\"",
                    block.name,
                    exe.display()
                ));
                if allow.is_none() {
                    fix_allow(&mut commands);
                }
            }
            RuleState::Blocked {
                rule: block.name.clone(),
                program,
            }
        } else if let Some(a) = allow {
            RuleState::Present {
                rule: a.name.clone(),
            }
        } else if rules.iter().any(|r| ours(&r)) {
            fix_allow(&mut commands);
            RuleState::Disabled
        } else {
            commands.push(add_rule(protocol, port));
            RuleState::Missing
        };
        checks.push(RuleCheck {
            protocol,
            port,
            name,
            state,
        });
    }
    let mut seen = std::collections::HashSet::new();
    commands.retain(|c| seen.insert(c.clone()));
    Report {
        rules: checks,
        commands,
        english,
    }
}

/// What came of the elevated batch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Elevation {
    /// `netsh` ran; its exit code is 0 when every line succeeded.
    Ran(u32),
    /// The user refused the UAC prompt.
    Declined,
}

#[cfg(windows)]
fn netsh_exe() -> std::path::PathBuf {
    // The full path, so a `netsh.exe` earlier in PATH or in the working folder is never the one elevated.
    std::env::var_os("SystemRoot")
        .map(|r| Path::new(&r).join("System32").join("netsh.exe"))
        .unwrap_or_else(|| "netsh.exe".into())
}

/// The inbound rules, read-only.
#[cfg(windows)]
pub fn read_rules() -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    // `dir=in` keeps it fast: the verbose listing of every direction takes minutes on a machine with many rules.
    let out = std::process::Command::new(netsh_exe())
        .args([
            "advfirewall",
            "firewall",
            "show",
            "rule",
            "name=all",
            "dir=in",
            "verbose",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("netsh: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "netsh {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stdout).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(not(windows))]
pub fn read_rules() -> Result<String, String> {
    Err("Windows Firewall exists only on Windows".to_owned())
}

/// The script `netsh -f` runs: one command per line.
pub fn script(commands: &[String]) -> String {
    commands.iter().map(|c| format!("{c}\r\n")).collect()
}

/// Runs `netsh -f <script>` elevated through `ShellExecuteExW` with the `runas` verb and waits for it. Blocks
/// for as long as the UAC prompt is open; call it off the async runtime. `parent` is the window the prompt
/// belongs to.
#[cfg(windows)]
pub fn run_elevated(script: &Path, parent: Option<isize>) -> Result<Elevation, String> {
    use windows_sys::Win32::Foundation::{
        CloseHandle, ERROR_CANCELLED, GetLastError, WAIT_OBJECT_0,
    };
    use windows_sys::Win32::System::Com::{
        COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoInitializeEx, CoUninitialize,
    };
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, INFINITE, WaitForSingleObject,
    };
    use windows_sys::Win32::UI::Shell::{
        SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

    fn wide(s: &std::ffi::OsStr) -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        s.encode_wide().chain(std::iter::once(0)).collect()
    }
    let verb = wide("runas".as_ref());
    let file = wide(netsh_exe().as_os_str());
    let params = wide(format!("-f \"{}\"", script.display()).as_ref());
    // SAFETY: plain Win32 calls on this thread with buffers that outlive them; the process handle is closed
    // on every path once it was returned.
    unsafe {
        // ShellExecuteEx may hand the verb to shell extensions, which expect COM on the calling thread.
        let com = CoInitializeEx(
            std::ptr::null(),
            (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
        );
        let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOCLOSEPROCESS;
        info.hwnd = parent.map_or(std::ptr::null_mut(), |h| h as _);
        info.lpVerb = verb.as_ptr();
        info.lpFile = file.as_ptr();
        info.lpParameters = params.as_ptr();
        info.nShow = SW_HIDE;
        let started = ShellExecuteExW(&mut info);
        let last = GetLastError();
        let result = if started == 0 {
            if last == ERROR_CANCELLED {
                Ok(Elevation::Declined)
            } else {
                Err(format!("ShellExecuteExW runas netsh: error {last}"))
            }
        } else if info.hProcess.is_null() {
            Err("ShellExecuteExW returned no process".to_owned())
        } else {
            let mut code = 1u32;
            let waited = WaitForSingleObject(info.hProcess, INFINITE);
            let read = GetExitCodeProcess(info.hProcess, &mut code);
            CloseHandle(info.hProcess);
            if waited == WAIT_OBJECT_0 && read != 0 {
                Ok(Elevation::Ran(code))
            } else {
                Err("netsh did not report how it ended".to_owned())
            }
        };
        if com >= 0 {
            CoUninitialize();
        }
        result
    }
}

#[cfg(not(windows))]
pub fn run_elevated(_script: &Path, _parent: Option<isize>) -> Result<Elevation, String> {
    Err("Windows Firewall exists only on Windows".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXE: &str = "C:\\Users\\a\\AppData\\Local\\LAN Hub\\LanHub.exe";

    /// Captured on this Windows 10 machine (English display language) with
    /// `netsh advfirewall firewall show rule name=all dir=in verbose`, cut to the rules that matter here, plus
    /// one block rule as Windows writes it for a program whose firewall prompt was cancelled.
    const ENGLISH: &str = "
Rule Name:                            lanhub-cli.exe
----------------------------------------------------------------------
Description:                          lanhub-cli.exe
Enabled:                              Yes
Direction:                            In
Profiles:                             Private,Public
Grouping:
LocalIP:                              Any
RemoteIP:                             Any
Protocol:                             UDP
LocalPort:                            Any
RemotePort:                           Any
Edge traversal:                       No
Program:                              C:\\users\\bdt-quy\\scratchpad\\b7\\bin\\lanhub-cli.exe
InterfaceTypes:                       Any
Security:                             NotRequired
Rule source:                          Local Setting
Action:                               Block

Rule Name:                            LAN Hub TCP 8200
----------------------------------------------------------------------
Enabled:                              Yes
Direction:                            In
Profiles:                             Domain,Private,Public
Grouping:
LocalIP:                              Any
RemoteIP:                             Any
Protocol:                             TCP
LocalPort:                            8200
RemotePort:                           Any
Edge traversal:                       No
InterfaceTypes:                       Any
Security:                             NotRequired
Rule source:                          Local Setting
Action:                               Allow

Rule Name:                            LAN Hub UDP 8201
----------------------------------------------------------------------
Enabled:                              No
Direction:                            In
Profiles:                             Domain,Private,Public
Grouping:
LocalIP:                              Any
RemoteIP:                             Any
Protocol:                             UDP
LocalPort:                            8201
RemotePort:                           Any
Edge traversal:                       No
InterfaceTypes:                       Any
Security:                             NotRequired
Rule source:                          Local Setting
Action:                               Allow
Ok.

";

    /// The same rules as a Vietnamese display language prints them. No Vietnamese Windows was at hand, so
    /// the labels are translated by hand; the parser reads only the dashed rule headers, which every language
    /// keeps.
    const VIETNAMESE: &str = "
Tên quy tắc:                          LAN Hub TCP 8200
----------------------------------------------------------------------
Đã bật:                               Có
Hướng:                                Vào
Cấu hình:                             Miền,Riêng,Công cộng
Nhóm:
IP cục bộ:                            Bất kỳ
IP từ xa:                             Bất kỳ
Giao thức:                            TCP
Cổng cục bộ:                          8200
Cổng từ xa:                           Bất kỳ
Truyền qua cạnh:                      Không
Hành động:                            Cho phép
OK.

";

    fn state(r: &Report, p: Protocol) -> &RuleState {
        &r.rules.iter().find(|c| c.protocol == p).unwrap().state
    }

    #[test]
    fn firewall_english_present_and_disabled() {
        let wants = [(Protocol::Tcp, 8200), (Protocol::Udp, 8201)];
        let r = judge(ENGLISH, &wants, Path::new(EXE));
        assert!(r.english);
        assert_eq!(
            state(&r, Protocol::Tcp),
            &RuleState::Present {
                rule: "LAN Hub TCP 8200".into()
            }
        );
        assert_eq!(state(&r, Protocol::Udp), &RuleState::Disabled);
        assert_eq!(
            r.commands,
            [
                "advfirewall firewall set rule name=\"LAN Hub UDP 8201\" dir=in new enable=yes action=allow protocol=UDP localport=8201"
            ]
        );
    }

    #[test]
    fn firewall_english_missing_rules_are_added_once() {
        let wants = [(Protocol::Tcp, 8210), (Protocol::Udp, 9201)];
        let r = judge(ENGLISH, &wants, Path::new(EXE));
        assert_eq!(state(&r, Protocol::Tcp), &RuleState::Missing);
        assert_eq!(state(&r, Protocol::Udp), &RuleState::Missing);
        assert_eq!(
            r.commands,
            [
                "advfirewall firewall add rule name=\"LAN Hub TCP 8210\" dir=in action=allow protocol=TCP localport=8210",
                "advfirewall firewall add rule name=\"LAN Hub UDP 9201\" dir=in action=allow protocol=UDP localport=9201",
            ]
        );
        assert_eq!(
            script(&r.commands),
            format!("{}\r\n{}\r\n", r.commands[0], r.commands[1])
        );
    }

    #[test]
    fn firewall_block_rule_of_this_program_is_removed_and_others_are_reported() {
        let ours = "C:\\users\\bdt-quy\\scratchpad\\b7\\bin\\lanhub-cli.exe";
        let r = judge(ENGLISH, &[(Protocol::Udp, 8201)], Path::new(ours));
        assert_eq!(
            state(&r, Protocol::Udp),
            &RuleState::Blocked {
                rule: "lanhub-cli.exe".into(),
                program: true
            }
        );
        assert_eq!(
            r.commands,
            [
                format!("advfirewall firewall delete rule name=\"lanhub-cli.exe\" dir=in program=\"{ours}\""),
                "advfirewall firewall set rule name=\"LAN Hub UDP 8201\" dir=in new enable=yes action=allow protocol=UDP localport=8201".to_owned(),
            ]
        );
        let global = ENGLISH.replace(
            &format!("Program:                              {ours}\n"),
            "",
        );
        let r = judge(&global, &[(Protocol::Udp, 8201)], Path::new(EXE));
        assert_eq!(
            state(&r, Protocol::Udp),
            &RuleState::Blocked {
                rule: "lanhub-cli.exe".into(),
                program: false
            }
        );
        assert!(r.commands.is_empty(), "{:?}", r.commands);
    }

    #[test]
    fn firewall_vietnamese_rules_are_found_by_name() {
        let r = judge(
            VIETNAMESE,
            &[(Protocol::Tcp, 8200), (Protocol::Udp, 8201)],
            Path::new(EXE),
        );
        assert!(!r.english);
        assert_eq!(
            state(&r, Protocol::Tcp),
            &RuleState::Present {
                rule: "LAN Hub TCP 8200".into()
            }
        );
        assert_eq!(state(&r, Protocol::Udp), &RuleState::Missing);
        assert_eq!(
            r.commands,
            [
                "advfirewall firewall add rule name=\"LAN Hub UDP 8201\" dir=in action=allow protocol=UDP localport=8201"
            ]
        );
    }

    #[test]
    fn firewall_no_rule_at_all() {
        let r = judge(
            "\nNo rules match the specified criteria.\n",
            &[(Protocol::Tcp, 8200)],
            Path::new(EXE),
        );
        assert_eq!(state(&r, Protocol::Tcp), &RuleState::Missing);
        assert_eq!(r.commands.len(), 1);
    }
}

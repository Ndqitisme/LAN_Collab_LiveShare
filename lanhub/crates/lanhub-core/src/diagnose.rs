//! `lanhub-cli --diagnose`: a read-only self-check of what keeps clients from reaching the hub. It parses
//! the config, looks for a process listening on the TCP port and binds both ports without listening
//! (releasing them at once), lists the IPv4 interfaces, inspects the TLS certificate without generating
//! one, and on Windows reads the firewall rules with `netsh advfirewall firewall show rule` (never `add` or
//! `set`). Each check is one line with `ok`, `fail` or `skip`, and a failing one carries a fix hint.

use std::fmt;
use std::net::ToSocketAddrs;
use std::path::{Path, PathBuf};

use socket2::{Domain, Socket, Type};

use crate::config::{self, HubSettings};
use crate::{tls, util};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Ok,
    Fail,
    /// Not applicable here (discovery off, firewall on another OS).
    Skip,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Check {
    pub status: Status,
    pub name: &'static str,
    pub detail: String,
    pub hint: Option<String>,
}

impl Check {
    fn ok(name: &'static str, detail: impl Into<String>) -> Check {
        Check {
            status: Status::Ok,
            name,
            detail: detail.into(),
            hint: None,
        }
    }

    fn skip(name: &'static str, detail: impl Into<String>) -> Check {
        Check {
            status: Status::Skip,
            name,
            detail: detail.into(),
            hint: None,
        }
    }

    fn fail(name: &'static str, detail: impl Into<String>, hint: impl Into<String>) -> Check {
        Check {
            status: Status::Fail,
            name,
            detail: detail.into(),
            hint: Some(hint.into()),
        }
    }
}

impl fmt::Display for Check {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let status = match self.status {
            Status::Ok => "ok",
            Status::Fail => "fail",
            Status::Skip => "skip",
        };
        write!(f, "{status:<4} {:<12} {}", self.name, self.detail)?;
        if let Some(h) = &self.hint {
            write!(f, " | Cách sửa: {h}")?;
        }
        Ok(())
    }
}

/// Where the hub settings come from.
pub enum Source {
    /// A `lanhub.toml`; its errors are reported with file, line and column.
    File(PathBuf),
    /// The single-project flags.
    Flags(HubSettings),
}

/// Runs every check. `adjust` applies the command-line overrides to the settings that were read.
pub fn run(source: Source, adjust: impl Fn(&mut HubSettings)) -> Vec<Check> {
    let (config, mut hub) = check_config(source);
    let mut out = vec![config];
    adjust(&mut hub);
    out.push(check_tcp(&hub.bind, hub.port));
    out.push(if hub.discovery {
        check_udp(hub.discovery_port)
    } else {
        Check::skip("discovery", "tắt (discovery = false)")
    });
    out.push(check_interfaces(&hub.public_address));
    out.push(check_tls(&hub));
    out.extend(check_firewall(&hub));
    out
}

/// The config check and the hub settings the other checks use (the defaults when the file is broken).
pub fn check_config(source: Source) -> (Check, HubSettings) {
    let file = match source {
        Source::Flags(hub) => {
            return (
                Check::ok("config", "tham số dòng lệnh, không dùng file cấu hình"),
                hub,
            );
        }
        Source::File(file) => file,
    };
    match config::load(&file) {
        Ok(c) => {
            let enabled = c.projects.iter().filter(|p| p.enabled).count();
            let detail = format!(
                "{}: {} dự án ({enabled} đang bật)",
                file.display(),
                c.projects.len()
            );
            (Check::ok("config", detail), c.hub)
        }
        Err(e) => {
            let hint = if e.line > 0 {
                format!("sửa dòng {} của file rồi chạy lại.", e.line)
            } else {
                "tạo file, hoặc chỉ ra file bằng --config <file>.".to_owned()
            };
            (
                Check::fail("config", e.to_string(), hint),
                HubSettings::default(),
            )
        }
    }
}

fn owner_text(owner: Option<Owner>) -> String {
    match owner {
        Some(Owner { pid, name: Some(n) }) => format!("; tiến trình PID {pid} ({n}) đang giữ cổng"),
        Some(Owner { pid, name: None }) => format!("; tiến trình PID {pid} đang giữ cổng"),
        None => String::new(),
    }
}

fn is_lanhub(owner: &Option<Owner>) -> bool {
    owner
        .as_ref()
        .and_then(|o| o.name.as_deref())
        .is_some_and(|n| {
            n.to_lowercase().contains("lanhub") || n.to_lowercase().contains("lan hub")
        })
}

/// Binds a socket without listening on it, then closes it. A listening socket on a wildcard address makes
/// Windows Firewall show its "allow access" prompt and, when nobody answers, add block rules for this
/// program: a self-check must change nothing.
fn try_bind(bind: &str, port: u16, ty: Type) -> std::io::Result<()> {
    let addr = (bind, port)
        .to_socket_addrs()?
        .next()
        .ok_or_else(|| std::io::Error::other("không có địa chỉ"))?;
    Socket::new(Domain::for_address(addr), ty, None)?.bind(&addr.into())
}

pub fn check_tcp(bind: &str, port: u16) -> Check {
    // A listener on another address of the same port may not stop a bare bind, so the table speaks first.
    let listening = (port != 0).then(|| tcp_owner(port)).flatten();
    let result = match &listening {
        Some(_) => Err(std::io::Error::from(std::io::ErrorKind::AddrInUse)),
        None => try_bind(bind, port, Type::STREAM),
    };
    match result {
        Ok(()) => Check::ok("tcp", format!("mở được cổng TCP {bind}:{port}")),
        Err(e) => {
            let owner = listening.or_else(|| tcp_owner(port));
            let hint = if is_lanhub(&owner) {
                "LAN Hub đã chạy trên cổng này; dừng bản đang chạy trước khi mở bản khác."
                    .to_owned()
            } else if owner.is_some() {
                "dừng tiến trình đó, hoặc đổi `port` trong [hub] của lanhub.toml.".to_owned()
            } else {
                format!(
                    "kiểm tra `bind` (địa chỉ phải thuộc máy này) và `port` trong [hub]; cổng {port} có thể đang bị chiếm."
                )
            };
            Check::fail(
                "tcp",
                format!(
                    "không mở được cổng TCP {bind}:{port}: {e}{}",
                    owner_text(owner)
                ),
                hint,
            )
        }
    }
}

pub fn check_udp(port: u16) -> Check {
    // On Windows even a bare UDP bind on 0.0.0.0 triggers the firewall prompt (and its block rules), so the
    // socket table decides and the bind uses loopback, which still meets a reserved or exclusive port.
    let held = udp_owner(port);
    let result = match &held {
        Some(_) => Err(std::io::Error::from(std::io::ErrorKind::AddrInUse)),
        None => try_bind(
            if cfg!(windows) {
                "127.0.0.1"
            } else {
                "0.0.0.0"
            },
            port,
            Type::DGRAM,
        ),
    };
    match result {
        Ok(()) => Check::ok(
            "discovery",
            format!("mở được cổng UDP {port} để máy khác tự tìm LAN Hub"),
        ),
        Err(e) => {
            let owner = held.or_else(|| udp_owner(port));
            let hint = if is_lanhub(&owner) {
                "LAN Hub đã chạy và giữ cổng này.".to_owned()
            } else {
                "dừng tiến trình đó, hoặc đổi `discovery_port` trong [hub]; máy khác vẫn vào được bằng mã mời.".to_owned()
            };
            Check::fail(
                "discovery",
                format!("không mở được cổng UDP {port}: {e}{}", owner_text(owner)),
                hint,
            )
        }
    }
}

fn check_interfaces(public: &[String]) -> Check {
    let list = util::ipv4_interfaces();
    let public = if public.is_empty() {
        String::new()
    } else {
        format!("; địa chỉ công khai: {}", public.join(", "))
    };
    if list.is_empty() {
        return Check::fail(
            "interfaces",
            format!("không có địa chỉ IPv4 nào ngoài loopback{public}"),
            "chỉ máy này kết nối được; bật card mạng hoặc kết nối Wi-Fi.",
        );
    }
    let shown: Vec<String> = list
        .iter()
        .map(|(name, ip)| format!("{ip} ({name})"))
        .collect();
    Check::ok("interfaces", format!("{}{public}", shown.join(", ")))
}

fn check_tls(hub: &HubSettings) -> Check {
    if !hub.tls.enabled {
        return Check::ok("tls", "tắt");
    }
    match tls::inspect(&hub.tls, hub.state_dir.as_deref()) {
        Ok(Some(id)) => Check::ok(
            "tls",
            format!(
                "bật; fingerprint SHA256 {} ({})",
                id.fingerprint,
                id.source.path().display()
            ),
        ),
        Ok(None) => Check::ok(
            "tls",
            format!(
                "bật; chứng chỉ tự ký được tạo khi LAN Hub chạy lần đầu, tại {}",
                tls::generated_path(hub.state_dir.as_deref().unwrap_or(Path::new("."))).display()
            ),
        ),
        Err(e) => Check::fail(
            "tls",
            e,
            "kiểm tra `cert` và `key` trong [hub.tls]: file PEM, chứng chỉ trước, khoá riêng khớp với chứng chỉ.",
        ),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Owner {
    pub pid: u32,
    pub name: Option<String>,
}

/// One rule of `netsh advfirewall firewall show rule name=all dir=in verbose`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FirewallRule {
    pub name: String,
    pub enabled: bool,
    pub inbound: bool,
    pub protocol: String,
    pub local_port: String,
    pub program: Option<String>,
    pub allow: bool,
    pub profiles: String,
}

/// Parses the English output of `netsh advfirewall firewall show rule`. Field names are localized on other
/// Windows display languages; such output yields no rule, which the caller reports as unreadable.
pub fn parse_rules(text: &str) -> Vec<FirewallRule> {
    let mut out = Vec::new();
    let mut cur: Option<FirewallRule> = None;
    for line in text.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let (key, value) = (key.trim(), value.trim());
        if key == "Rule Name" {
            out.extend(cur.take());
            cur = Some(FirewallRule {
                name: value.to_owned(),
                ..FirewallRule::default()
            });
            continue;
        }
        let Some(r) = cur.as_mut() else { continue };
        match key {
            "Enabled" => r.enabled = value.eq_ignore_ascii_case("yes"),
            "Direction" => r.inbound = value.eq_ignore_ascii_case("in"),
            "Protocol" => r.protocol = value.to_owned(),
            "LocalPort" => r.local_port = value.to_owned(),
            "Program" => r.program = Some(value.to_owned()),
            "Action" => r.allow = value.eq_ignore_ascii_case("allow"),
            "Profiles" => r.profiles = value.to_owned(),
            _ => {}
        }
    }
    out.extend(cur);
    out
}

/// `Any`, `8200`, `8200,8300` or `8000-8300`.
fn port_matches(spec: &str, port: u16) -> bool {
    spec.split(',').map(str::trim).any(|part| {
        if part.eq_ignore_ascii_case("any") {
            return true;
        }
        match part.split_once('-') {
            Some((a, b)) => matches!((a.parse::<u16>(), b.parse::<u16>()), (Ok(a), Ok(b)) if (a..=b).contains(&port)),
            None => part.parse::<u16>() == Ok(port),
        }
    })
}

/// Whether the rule covers inbound `protocol` traffic to `port` of the program `exe`. A rule without
/// `LocalPort` (protocol Any) covers every port.
pub fn covers(rule: &FirewallRule, protocol: &str, port: u16, exe: &Path) -> bool {
    // netsh prints neither the package (Store apps) nor the user a rule is limited to. Such rules show no
    // program and protocol Any; read literally they would allow or block every port, so they are left out.
    if rule.program.is_none() && rule.protocol.eq_ignore_ascii_case("any") {
        return false;
    }
    let program_ok = match rule.program.as_deref() {
        None => true,
        Some(p) if p.eq_ignore_ascii_case("any") => true,
        Some(p) => config::same_path(Path::new(p), exe),
    };
    let protocol_ok =
        rule.protocol.eq_ignore_ascii_case("any") || rule.protocol.eq_ignore_ascii_case(protocol);
    let port_ok = rule.local_port.is_empty() || port_matches(&rule.local_port, port);
    rule.enabled && rule.inbound && program_ok && protocol_ok && port_ok
}

/// A firewall profile in force (`netsh advfirewall show currentprofile`) and whether it filters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Profile {
    pub name: String,
    pub on: bool,
}

/// Parses the English output of `netsh advfirewall show currentprofile`: a `<Name> Profile Settings:`
/// header, then a `State ON|OFF` line, per active profile (one per kind of network the machine is on).
pub fn parse_profiles(text: &str) -> Vec<Profile> {
    let mut out: Vec<Profile> = Vec::new();
    for line in text.lines().map(str::trim) {
        if let Some(name) = line.strip_suffix("Profile Settings:") {
            out.push(Profile {
                name: name.trim().to_owned(),
                on: true,
            });
        } else if let Some(state) = line.strip_prefix("State")
            && let Some(p) = out.last_mut()
        {
            p.on = !state.trim().eq_ignore_ascii_case("off");
        }
    }
    out
}

fn in_profile(rule: &FirewallRule, profile: &str) -> bool {
    rule.profiles.eq_ignore_ascii_case("any")
        || rule
            .profiles
            .split(',')
            .any(|p| p.trim().eq_ignore_ascii_case(profile))
}

/// The verdict for one protocol and port in each active profile that filters: an enabled inbound block
/// rule wins over any allow rule, as in Windows Firewall. `ok` only when every such profile lets the
/// traffic in, because clients may come through any of the networks.
pub fn firewall_verdict(
    rules: &[FirewallRule],
    profiles: &[Profile],
    name: &'static str,
    protocol: &str,
    port: u16,
    exe: &Path,
) -> Check {
    let filtering: Vec<&Profile> = profiles.iter().filter(|p| p.on).collect();
    if filtering.is_empty() {
        return Check::ok(name, "tường lửa Windows đang tắt");
    }
    let add = format!(
        "chạy trong cửa sổ quản trị: netsh advfirewall firewall add rule name=\"LAN Hub {protocol} {port}\" dir=in action=allow protocol={protocol} localport={port}"
    );
    let mut parts = Vec::new();
    let mut blocked_by: Vec<&str> = Vec::new();
    let mut all_allowed = true;
    for p in &filtering {
        let applies = |r: &&FirewallRule| covers(r, protocol, port, exe) && in_profile(r, &p.name);
        if let Some(b) = rules.iter().filter(|r| !r.allow).find(applies) {
            parts.push(format!("{}: quy tắc \"{}\" chặn", p.name, b.name));
            blocked_by.push(&b.name);
            all_allowed = false;
        } else if let Some(a) = rules.iter().filter(|r| r.allow).find(applies) {
            parts.push(format!("{}: quy tắc \"{}\" cho phép", p.name, a.name));
        } else {
            parts.push(format!("{}: không có quy tắc cho phép", p.name));
            all_allowed = false;
        }
    }
    let detail = format!("{protocol} {port} đi vào; {}", parts.join("; "));
    if all_allowed {
        return Check::ok(name, detail);
    }
    let hint = if blocked_by.is_empty() {
        add
    } else {
        blocked_by.dedup();
        format!(
            "tắt hoặc xoá quy tắc chặn \"{}\" trong Windows Defender Firewall, rồi {add}",
            blocked_by.join("\", \"")
        )
    };
    Check::fail(name, detail, hint)
}

/// Runs a read-only `netsh` command and returns its output.
#[cfg(windows)]
fn netsh(args: &[&str]) -> Result<String, String> {
    match std::process::Command::new("netsh").args(args).output() {
        Ok(o) if o.status.success() => Ok(String::from_utf8_lossy(&o.stdout).into_owned()),
        Ok(o) => Err(format!(
            "netsh {} trả về {}: {}",
            args.join(" "),
            o.status,
            String::from_utf8_lossy(&o.stdout).trim()
        )),
        Err(e) => Err(format!("không chạy được netsh: {e}")),
    }
}

#[cfg(windows)]
fn check_firewall(hub: &HubSettings) -> Vec<Check> {
    let manual = "kiểm tra quy tắc tường lửa bằng tay trong Windows Defender Firewall.";
    // `dir=in` matters for speed as well as scope: on a machine with ~700 rules the verbose listing of every
    // direction took minutes, inbound only half a second.
    let rules = match netsh(&[
        "advfirewall",
        "firewall",
        "show",
        "rule",
        "name=all",
        "dir=in",
        "verbose",
    ]) {
        Ok(text) => parse_rules(&text),
        Err(e) => return vec![Check::fail("firewall", e, manual)],
    };
    if rules.is_empty() {
        return vec![Check::fail(
            "firewall",
            "không đọc được danh sách quy tắc của netsh (Windows không dùng tiếng Anh?)",
            manual,
        )];
    }
    // Unknown profiles (a localized output) count as all three filtering.
    let mut profiles = netsh(&["advfirewall", "show", "currentprofile"])
        .map(|t| parse_profiles(&t))
        .unwrap_or_default();
    if profiles.is_empty() {
        profiles = ["Domain", "Private", "Public"]
            .iter()
            .map(|n| Profile {
                name: (*n).to_owned(),
                on: true,
            })
            .collect();
    }
    let exe = std::env::current_exe().unwrap_or_default();
    let mut out = vec![firewall_verdict(
        &rules,
        &profiles,
        "firewall-tcp",
        "TCP",
        hub.port,
        &exe,
    )];
    if hub.discovery {
        out.push(firewall_verdict(
            &rules,
            &profiles,
            "firewall-udp",
            "UDP",
            hub.discovery_port,
            &exe,
        ));
    }
    out
}

#[cfg(not(windows))]
fn check_firewall(_hub: &HubSettings) -> Vec<Check> {
    vec![Check::skip(
        "firewall",
        "chỉ kiểm tra trên Windows; trên Linux xem ufw, firewalld hoặc nftables",
    )]
}

#[cfg(windows)]
fn process_name(pid: u32) -> Option<String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        QueryFullProcessImageNameW,
    };
    let h = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if h.is_null() {
        return None;
    }
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    let ok =
        unsafe { QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len) };
    unsafe { CloseHandle(h) };
    if ok == 0 {
        return None;
    }
    let path = String::from_utf16_lossy(&buf[..len as usize]);
    Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
}

/// Rows of an owner-pid table from `GetExtendedTcpTable`/`GetExtendedUdpTable` as (local port, pid).
#[cfg(windows)]
fn owner_rows(
    fetch: impl Fn(*mut core::ffi::c_void, *mut u32) -> u32,
    row_words: usize,
    port_word: usize,
    pid_word: usize,
) -> Vec<(u16, u32)> {
    use windows_sys::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, NO_ERROR};
    let mut size: u32 = 64 * 1024;
    let mut buf: Vec<u32>;
    loop {
        buf = vec![0u32; (size as usize).div_ceil(4)];
        match fetch(buf.as_mut_ptr().cast(), &mut size) {
            NO_ERROR => break,
            ERROR_INSUFFICIENT_BUFFER => continue,
            _ => return Vec::new(),
        }
    }
    let n = buf[0] as usize;
    (0..n)
        .filter_map(|i| {
            let row = buf.get(1 + i * row_words..1 + (i + 1) * row_words)?;
            // The port is in network byte order in the low 16 bits.
            Some((u16::from_be(row[port_word] as u16), row[pid_word]))
        })
        .collect()
}

#[cfg(windows)]
pub fn tcp_owner(port: u16) -> Option<Owner> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, TCP_TABLE_OWNER_PID_LISTENER,
    };
    use windows_sys::Win32::Networking::WinSock::AF_INET;
    // MIB_TCPROW_OWNER_PID: state, local addr, local port, remote addr, remote port, pid.
    let rows = owner_rows(
        |p, size| unsafe {
            GetExtendedTcpTable(
                p,
                size,
                0,
                u32::from(AF_INET),
                TCP_TABLE_OWNER_PID_LISTENER,
                0,
            )
        },
        6,
        2,
        5,
    );
    let pid = rows.into_iter().find(|(p, _)| *p == port)?.1;
    Some(Owner {
        pid,
        name: process_name(pid),
    })
}

#[cfg(windows)]
pub fn udp_owner(port: u16) -> Option<Owner> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetExtendedUdpTable, UDP_TABLE_OWNER_PID,
    };
    use windows_sys::Win32::Networking::WinSock::AF_INET;
    // MIB_UDPROW_OWNER_PID: local addr, local port, pid.
    let rows = owner_rows(
        |p, size| unsafe {
            GetExtendedUdpTable(p, size, 0, u32::from(AF_INET), UDP_TABLE_OWNER_PID, 0)
        },
        3,
        1,
        2,
    );
    let pid = rows.into_iter().find(|(p, _)| *p == port)?.1;
    Some(Owner {
        pid,
        name: process_name(pid),
    })
}

/// Finding the owner of a port needs /proc walking on Linux; the hint names `ss -ltnp` instead.
#[cfg(not(windows))]
pub fn tcp_owner(_port: u16) -> Option<Owner> {
    None
}

#[cfg(not(windows))]
pub fn udp_owner(_port: u16) -> Option<Owner> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "
Rule Name:                            lanhub-cli.exe
----------------------------------------------------------------------
Enabled:                              Yes
Direction:                            In
Profiles:                             Public
Protocol:                             TCP
LocalPort:                            Any
Program:                              C:\\other\\lanhub-cli.exe
Action:                               Block

Rule Name:                            LAN Hub TCP 8200
----------------------------------------------------------------------
Enabled:                              Yes
Direction:                            In
Profiles:                             Domain,Private,Public
Protocol:                             TCP
LocalPort:                            8100-8300
Program:                              Any
Action:                               Allow

Rule Name:                            Microsoft Store
----------------------------------------------------------------------
Enabled:                              Yes
Direction:                            In
Profiles:                             Domain,Private,Public
Protocol:                             Any
Action:                               Allow

Rule Name:                            Old UDP
----------------------------------------------------------------------
Enabled:                              No
Direction:                            In
Profiles:                             Private
Protocol:                             UDP
LocalPort:                            8201
Action:                               Allow
";

    const PROFILES: &str = "Private Profile Settings: \n----\nState                                 ON\nFirewall Policy   BlockInbound,AllowOutbound\n\nPublic Profile Settings: \n----\nState                                 ON\n";

    #[test]
    fn firewall_rules_parse_and_judge() {
        let rules = parse_rules(SAMPLE);
        assert_eq!(rules.len(), 4);
        assert_eq!(
            rules[0].program.as_deref(),
            Some("C:\\other\\lanhub-cli.exe")
        );
        let profiles = parse_profiles(PROFILES);
        let on = |n: &str| Profile {
            name: n.to_owned(),
            on: true,
        };
        assert_eq!(profiles, [on("Private"), on("Public")]);
        let exe = Path::new("C:\\hub\\lanhub-cli.exe");
        let tcp = firewall_verdict(&rules, &profiles, "firewall-tcp", "TCP", 8200, exe);
        assert_eq!(tcp.status, Status::Ok, "{tcp}");
        assert!(tcp.detail.contains("LAN Hub TCP 8200"));
        let other = firewall_verdict(&rules, &profiles, "firewall-tcp", "TCP", 9000, exe);
        assert_eq!(
            other.status,
            Status::Fail,
            "a package-scoped rule allows nothing here: {other}"
        );
        let udp = firewall_verdict(&rules, &profiles, "firewall-udp", "UDP", 8201, exe);
        assert_eq!(udp.status, Status::Fail, "a disabled rule allows nothing");
        assert!(udp.hint.unwrap().contains(
            "netsh advfirewall firewall add rule name=\"LAN Hub UDP 8201\" dir=in action=allow protocol=UDP localport=8201"
        ));
        if cfg!(windows) {
            let blocked_exe = Path::new("c:\\OTHER\\lanhub-cli.exe");
            let blocked =
                firewall_verdict(&rules, &profiles, "firewall-tcp", "TCP", 8200, blocked_exe);
            assert_eq!(
                blocked.status,
                Status::Fail,
                "the block rule wins in Public"
            );
            assert!(
                blocked
                    .detail
                    .contains("Private: quy tắc \"LAN Hub TCP 8200\" cho phép"),
                "{blocked}"
            );
            let private = [on("Private")];
            let only_private =
                firewall_verdict(&rules, &private, "firewall-tcp", "TCP", 8200, blocked_exe);
            assert_eq!(only_private.status, Status::Ok, "{only_private}");
        }
        let off = [Profile {
            name: "Private".to_owned(),
            on: false,
        }];
        let fw_off = firewall_verdict(&rules, &off, "firewall-tcp", "TCP", 9000, exe);
        assert_eq!(fw_off.status, Status::Ok);
    }

    #[test]
    fn port_specs() {
        assert!(port_matches("Any", 1));
        assert!(port_matches("80,8200", 8200));
        assert!(port_matches("8000-8300", 8200));
        assert!(!port_matches("8000-8100", 8200));
        assert!(!port_matches("RPC", 8200));
    }
}

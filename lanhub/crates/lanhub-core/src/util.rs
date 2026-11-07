//! Small pieces the Node hub gets from its runtime: random ids, SHA-1, clocks, Buffer's base64, host name.

use std::time::{SystemTime, UNIX_EPOCH};

use sha1::{Digest, Sha1};

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).expect("the OS random source is available");
    b
}

pub fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(char::from(b"0123456789abcdef"[usize::from(b >> 4)]));
        s.push(char::from(b"0123456789abcdef"[usize::from(b & 15)]));
    }
    s
}

pub fn random_hex<const N: usize>() -> String {
    hex(&random_bytes::<N>())
}

/// `crypto.randomUUID()`.
pub fn random_uuid() -> String {
    let mut b = random_bytes::<16>();
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h = hex(&b);
    format!(
        "{}-{}-{}-{}-{}",
        &h[..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..]
    )
}

/// Lowercase hex SHA-1.
pub fn sha1_hex(bytes: &[u8]) -> String {
    hex(&Sha1::digest(bytes))
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// `new Date().toISOString()`.
pub fn iso_now() -> String {
    let ms = now_ms();
    let days = (ms / 86_400_000) as i64;
    let rem = ms % 86_400_000;
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3_600_000,
        rem / 60_000 % 60,
        rem / 1000 % 60,
        rem % 1000
    )
}

/// Days since 1970-01-01 to a proleptic Gregorian date (Howard Hinnant's algorithm).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// Local wall-clock time as `HH:MM:SS`, the Node hub's log prefix.
#[cfg(windows)]
pub fn local_time() -> String {
    let mut t: windows_sys::Win32::Foundation::SYSTEMTIME = unsafe { std::mem::zeroed() };
    unsafe { windows_sys::Win32::System::SystemInformation::GetLocalTime(&mut t) };
    format!("{:02}:{:02}:{:02}", t.wHour, t.wMinute, t.wSecond)
}

#[cfg(unix)]
pub fn local_time() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0) as libc::time_t;
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    unsafe { libc::localtime_r(&now, &mut tm) };
    format!("{:02}:{:02}:{:02}", tm.tm_hour, tm.tm_min, tm.tm_sec)
}

/// One human log line on stdout. These never start with `{"event"` (docs/protocol.md section 16).
pub fn log(msg: impl AsRef<str>) {
    crate::logs::log_in(None, msg.as_ref());
}

/// `os.hostname()`.
#[cfg(windows)]
pub fn hostname() -> String {
    use windows_sys::Win32::System::SystemInformation::{
        ComputerNameDnsHostname, GetComputerNameExW,
    };
    let mut buf = [0u16; 256];
    let mut len = buf.len() as u32;
    let ok = unsafe { GetComputerNameExW(ComputerNameDnsHostname, buf.as_mut_ptr(), &mut len) };
    if ok == 0 {
        return std::env::var("COMPUTERNAME").unwrap_or_default();
    }
    String::from_utf16_lossy(&buf[..len as usize])
}

#[cfg(unix)]
pub fn hostname() -> String {
    let mut buf = [0u8; 256];
    let rc = unsafe { libc::gethostname(buf.as_mut_ptr().cast(), buf.len()) };
    if rc != 0 {
        return String::new();
    }
    let end = buf.iter().position(|b| *b == 0).unwrap_or(buf.len());
    String::from_utf8_lossy(&buf[..end]).into_owned()
}

/// The non-internal IPv4 addresses of `os.networkInterfaces()`: adapters that are up, loopback left out, in
/// the order the OS lists them.
pub fn ipv4_addresses() -> Vec<std::net::Ipv4Addr> {
    ipv4_interfaces().into_iter().map(|(_, ip)| ip).collect()
}

/// `ipv4_addresses` with the name of each address's adapter.
#[cfg(windows)]
pub fn ipv4_interfaces() -> Vec<(String, std::net::Ipv4Addr)> {
    use windows_sys::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, NO_ERROR};
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_MULTICAST,
        GetAdaptersAddresses, IF_TYPE_SOFTWARE_LOOPBACK, IP_ADAPTER_ADDRESSES_LH,
    };
    use windows_sys::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    use windows_sys::Win32::Networking::WinSock::{AF_INET, SOCKADDR_IN};

    let flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;
    let mut size: u32 = 16 * 1024;
    let mut buf: Vec<u64>;
    loop {
        // u64 elements keep the list aligned for the structs inside it.
        buf = vec![0u64; (size as usize).div_ceil(8)];
        let rc = unsafe {
            GetAdaptersAddresses(
                u32::from(AF_INET),
                flags,
                std::ptr::null(),
                buf.as_mut_ptr().cast(),
                &mut size,
            )
        };
        match rc {
            NO_ERROR => break,
            ERROR_BUFFER_OVERFLOW => continue,
            _ => return Vec::new(),
        }
    }
    let mut out = Vec::new();
    let mut adapter = buf.as_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>();
    while !adapter.is_null() {
        let a = unsafe { &*adapter };
        if a.OperStatus == IfOperStatusUp && a.IfType != IF_TYPE_SOFTWARE_LOOPBACK {
            let name = if a.FriendlyName.is_null() {
                String::new()
            } else {
                let len = (0..)
                    .take_while(|&i| unsafe { *a.FriendlyName.add(i) } != 0)
                    .count();
                String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(a.FriendlyName, len) })
            };
            let mut unicast = a.FirstUnicastAddress;
            while !unicast.is_null() {
                let u = unsafe { &*unicast };
                let sa = u.Address.lpSockaddr;
                if !sa.is_null() && unsafe { (*sa).sa_family } == AF_INET {
                    let sin = unsafe { &*sa.cast::<SOCKADDR_IN>() };
                    let raw = unsafe { sin.sin_addr.S_un.S_addr };
                    out.push((name.clone(), std::net::Ipv4Addr::from(raw.to_ne_bytes())));
                }
                unicast = u.Next;
            }
        }
        adapter = a.Next;
    }
    out
}

#[cfg(unix)]
pub fn ipv4_interfaces() -> Vec<(String, std::net::Ipv4Addr)> {
    let mut list: *mut libc::ifaddrs = std::ptr::null_mut();
    if unsafe { libc::getifaddrs(&mut list) } != 0 {
        return Vec::new();
    }
    let up = (libc::IFF_UP | libc::IFF_RUNNING) as libc::c_uint;
    let mut out = Vec::new();
    let mut p = list;
    while !p.is_null() {
        let ifa = unsafe { &*p };
        let usable =
            ifa.ifa_flags & up == up && ifa.ifa_flags & libc::IFF_LOOPBACK as libc::c_uint == 0;
        if usable
            && !ifa.ifa_addr.is_null()
            && i32::from(unsafe { (*ifa.ifa_addr).sa_family }) == libc::AF_INET
        {
            let sin = unsafe { &*ifa.ifa_addr.cast::<libc::sockaddr_in>() };
            let name = unsafe { std::ffi::CStr::from_ptr(ifa.ifa_name) }
                .to_string_lossy()
                .into_owned();
            out.push((
                name,
                std::net::Ipv4Addr::from(sin.sin_addr.s_addr.to_ne_bytes()),
            ));
        }
        p = ifa.ifa_next;
    }
    unsafe { libc::freeifaddrs(list) };
    out
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// `buf.toString('base64')`.
pub fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(char::from(B64[((n >> (18 - 6 * i)) & 63) as usize]));
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// `Buffer.from(s, 'base64')`: accepts the standard and URL-safe alphabets, skips any other character,
/// stops at the first `=`, and drops a dangling sixth-bit group.
pub fn base64_decode_lenient(s: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let mut acc: u32 = 0;
    let mut bits = 0;
    for b in s.bytes() {
        let v = match b {
            b'A'..=b'Z' => b - b'A',
            b'a'..=b'z' => b - b'a' + 26,
            b'0'..=b'9' => b - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' => break,
            _ => continue,
        };
        acc = (acc << 6) | u32::from(v);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_node_buffer() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"a"), "YQ==");
        assert_eq!(base64_encode(b"ab"), "YWI=");
        assert_eq!(base64_encode(&[0xfb, 0xff, 0x00]), "+/8A");
        assert_eq!(base64_decode_lenient("ab$cd==ef"), vec![0x69, 0xb7, 0x1d]);
        assert_eq!(base64_decode_lenient("YW=Jj"), b"a");
        assert_eq!(base64_decode_lenient("YQ"), b"a");
        assert_eq!(base64_decode_lenient("Y"), b"");
        assert_eq!(base64_decode_lenient("-_8"), vec![0xfb, 0xff]);
        assert_eq!(base64_decode_lenient("YW Jj\nZA"), b"abcd");
    }

    #[test]
    fn civil_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_764), (2026, 11, 7));
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
    }

    #[test]
    fn uuid_shape() {
        let u = random_uuid();
        assert_eq!(u.len(), 36);
        assert_eq!(&u[14..15], "4");
    }
}

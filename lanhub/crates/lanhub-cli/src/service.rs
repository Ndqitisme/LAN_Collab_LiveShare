//! `--service`: runs `lanhub-cli` as a Windows service created with `sc.exe` (docs/lanhub-server.md). The
//! service control manager starts the process, calls `service_main` on a thread of its own, and sends stop
//! and shutdown requests to `handler`, which wakes `STOP`; `wait_for_stop` then lets the hub write every
//! pending file before the service reports that it stopped.

use std::process::ExitCode;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicPtr, Ordering};

use tokio::sync::Notify;
use windows_sys::Win32::Foundation::{
    ERROR_CALL_NOT_IMPLEMENTED, ERROR_SERVICE_SPECIFIC_ERROR, NO_ERROR,
};
use windows_sys::Win32::System::Services::{
    RegisterServiceCtrlHandlerExW, SERVICE_ACCEPT_SHUTDOWN, SERVICE_ACCEPT_STOP,
    SERVICE_CONTROL_INTERROGATE, SERVICE_CONTROL_SHUTDOWN, SERVICE_CONTROL_STOP, SERVICE_RUNNING,
    SERVICE_START_PENDING, SERVICE_STATUS, SERVICE_STOP_PENDING, SERVICE_STOPPED,
    SERVICE_TABLE_ENTRYW, SERVICE_WIN32_OWN_PROCESS, SetServiceStatus, StartServiceCtrlDispatcherW,
};

/// Woken by a stop or shutdown request of the service control manager.
pub static STOP: Notify = Notify::const_new();
/// How long the manager waits for the files to be written after a stop request.
const STOP_WAIT_MS: u32 = 30_000;

static ARGS: OnceLock<Vec<String>> = OnceLock::new();
static EXIT: OnceLock<u8> = OnceLock::new();
static HANDLE: AtomicPtr<core::ffi::c_void> = AtomicPtr::new(std::ptr::null_mut());

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn report(state: u32, exit: u32, wait_ms: u32) {
    let handle = HANDLE.load(Ordering::SeqCst);
    if handle.is_null() {
        return;
    }
    let status = SERVICE_STATUS {
        dwServiceType: SERVICE_WIN32_OWN_PROCESS,
        dwCurrentState: state,
        dwControlsAccepted: if state == SERVICE_RUNNING {
            SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN
        } else {
            0
        },
        dwWin32ExitCode: exit,
        dwServiceSpecificExitCode: 0,
        dwCheckPoint: 0,
        dwWaitHint: wait_ms,
    };
    // SAFETY: `handle` came from RegisterServiceCtrlHandlerExW and `status` lives for the call.
    unsafe { SetServiceStatus(handle, &status) };
}

unsafe extern "system" fn handler(
    control: u32,
    _event: u32,
    _data: *mut core::ffi::c_void,
    _context: *mut core::ffi::c_void,
) -> u32 {
    match control {
        SERVICE_CONTROL_STOP | SERVICE_CONTROL_SHUTDOWN => {
            report(SERVICE_STOP_PENDING, NO_ERROR, STOP_WAIT_MS);
            STOP.notify_one();
            NO_ERROR
        }
        SERVICE_CONTROL_INTERROGATE => NO_ERROR,
        _ => ERROR_CALL_NOT_IMPLEMENTED,
    }
}

unsafe extern "system" fn service_main(_argc: u32, _argv: *mut windows_sys::core::PWSTR) {
    let name = wide("LanHub");
    // SAFETY: `name` is NUL-terminated and outlives the call; the handler is a plain function.
    let handle =
        unsafe { RegisterServiceCtrlHandlerExW(name.as_ptr(), Some(handler), std::ptr::null()) };
    if handle.is_null() {
        return;
    }
    HANDLE.store(handle, Ordering::SeqCst);
    report(SERVICE_START_PENDING, NO_ERROR, STOP_WAIT_MS);
    report(SERVICE_RUNNING, NO_ERROR, 0);
    let args = ARGS.get().cloned().unwrap_or_default();
    let code = super::run(args);
    let failed = code != ExitCode::SUCCESS;
    let _ = EXIT.set(u8::from(failed));
    let exit = if failed {
        ERROR_SERVICE_SPECIFIC_ERROR
    } else {
        NO_ERROR
    };
    report(SERVICE_STOPPED, exit, 0);
}

/// Hands the process to the service control manager; returns once the service stopped. Started from a
/// console instead, it says how to create the service.
pub fn dispatch(args: Vec<String>) -> ExitCode {
    let _ = ARGS.set(args);
    let mut name = wide("LanHub");
    let table = [
        SERVICE_TABLE_ENTRYW {
            lpServiceName: name.as_mut_ptr(),
            lpServiceProc: Some(service_main),
        },
        SERVICE_TABLE_ENTRYW {
            lpServiceName: std::ptr::null_mut(),
            lpServiceProc: None,
        },
    ];
    // SAFETY: the table ends with a null entry and `name` outlives the dispatcher, which returns only once
    // the service has stopped.
    if unsafe { StartServiceCtrlDispatcherW(table.as_ptr()) } == 0 {
        eprintln!(
            "--service chỉ dùng khi Windows khởi động lanhub-cli như một dịch vụ. Tạo dịch vụ bằng sc.exe theo docs/lanhub-server.md: {}",
            std::io::Error::last_os_error()
        );
        return ExitCode::from(1);
    }
    ExitCode::from(EXIT.get().copied().unwrap_or(0))
}

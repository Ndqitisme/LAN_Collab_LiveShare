use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [] => {}
        [flag] if flag == "--version" || flag == "-V" => {}
        _ => {
            eprintln!("usage: lanhub-cli [--version]");
            return ExitCode::from(2);
        }
    }
    println!("lanhub-cli {}", env!("CARGO_PKG_VERSION"));
    ExitCode::SUCCESS
}

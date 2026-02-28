use clap::Parser;
use omnifocus_mcp::{jxa::RealJxaRunner, server::OmniFocusServer};
use rmcp::{transport::stdio, ServiceExt};

#[derive(Parser, Debug)]
#[command(name = "omnifocus-mcp", version, about = "OmniFocus MCP server")]
struct Cli {}

fn is_connection_closed(error: &dyn std::error::Error) -> bool {
    let message = error.to_string().to_lowercase();
    message.contains("connection closed") || message.contains("initialized request")
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _cli = Cli::parse();

    let server = OmniFocusServer::new(RealJxaRunner::new());
    let service = match server.serve(stdio()).await {
        Ok(service) => service,
        Err(error) => {
            if is_connection_closed(&error) {
                return Ok(());
            }
            return Err(std::io::Error::other(error.to_string()).into());
        }
    };
    let cancel_token = service.cancellation_token();
    let waiting = service.waiting();
    tokio::pin!(waiting);

    tokio::select! {
        result = &mut waiting => {
            if let Err(error) = result {
                if !is_connection_closed(&error) {
                    return Err(std::io::Error::other(error.to_string()).into());
                }
            }
        }
        _ = tokio::signal::ctrl_c() => {
            cancel_token.cancel();
            if let Err(error) = waiting.await {
                if !is_connection_closed(&error) {
                    return Err(std::io::Error::other(error.to_string()).into());
                }
            }
        }
    }

    Ok(())
}

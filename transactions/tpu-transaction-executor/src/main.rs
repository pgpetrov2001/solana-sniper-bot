use {
    solana_client::{
        connection_cache::ConnectionCache,
        tpu_client::{TpuClient, TpuClientConfig},
    },
    solana_rpc_client::rpc_client::RpcClient,
    solana_tpu_client::tpu_client::{ DEFAULT_TPU_CONNECTION_POOL_SIZE, TpuSenderError },
    solana_sdk::{
        transaction::{ Transaction, VersionedTransaction },
        commitment_config::CommitmentConfig,
    },
    std::{
        sync::Arc,
        env,
        str::FromStr,
    },
    dotenv::dotenv,
    argparse::{ArgumentParser, Store, StoreTrue},
    base64::Engine,
    bincode::deserialize,
};

#[tokio::main]
async fn main() {
    dotenv().ok();
    // Now you can access the variables from .env file

    let rpc_endpoint           = env::var("RPC_ENDPOINT").expect("RPC endpoint url must be set");
    let rpc_websocket_endpoint = env::var("RPC_WEBSOCKET_ENDPOINT").expect("RPC websocket endpoint url must be set");
    let commitment_level       = env::var("COMMITMENT_LEVEL").expect("Commitment level must be set");

    let commitment_level: CommitmentConfig = CommitmentConfig::from_str(
        &commitment_level
    ).expect("Commitment level should be processed/confirmed/finalized");

    //Read wire_transaction from command line arguments
    let mut wire_transaction = String::new();
    let mut is_versioned = false;
    {
        let mut ap = ArgumentParser::new();
        ap.set_description("Rust program sending raw transaction using tpu client.");

        ap.refer(&mut wire_transaction)
            .add_argument("wire_transaction", Store, "Wire transaction to send encoded in base64")
            .required();
        ap.refer(&mut is_versioned)
            .add_option(&["-v", "--versioned"], StoreTrue, "Whether the transaction is versioned or not");

        ap.parse_args_or_exit();
    }

    // Decode wire transaction into bytes (Vec<u8>)
    // Using this instead of base64::decode as per https://github.com/marshallpierce/rust-base64/issues/233
    let wire_transaction = base64::prelude::BASE64_STANDARD
        .decode(wire_transaction)
        .expect("Failed to decode wire transaction");

    //Decode the transaction to extract the signature, and return it from the script
    let tx_signature = {
        if is_versioned {
            let tx: VersionedTransaction = deserialize(&wire_transaction).unwrap();
            tx.signatures[0]
        } else {
            let tx: Transaction          = deserialize(&wire_transaction).unwrap();
            tx.signatures[0]
        }
    };

    let rpc_client = Arc::new(RpcClient::new_with_commitment(
        &rpc_endpoint,
        commitment_level,
    ));

    let connection_cache = ConnectionCache::new_quic("connection_cache_test", DEFAULT_TPU_CONNECTION_POOL_SIZE);
    let tpu_client = match connection_cache {
        ConnectionCache::Quic(cache) => TpuClient::new_with_connection_cache(
            rpc_client.clone(),
            &rpc_websocket_endpoint,
            TpuClientConfig::default(),
            cache,
        ),
        ConnectionCache::Udp(_) => Err(TpuSenderError::Custom("Matched incorrect type for connection cache".to_string())),
    }.unwrap();

    let recent_blockhash = rpc_client.get_latest_blockhash().unwrap();
    eprintln!("recent blockhash: {:?}", recent_blockhash);

    loop {
        let result = tpu_client.send_wire_transaction(wire_transaction.clone());
        eprintln!("send tx result: {:?}", result);
        if result {
            break;
        }
    }

    print!("{}", tx_signature);

    eprintln!("Sent transaction, exiting...");
}

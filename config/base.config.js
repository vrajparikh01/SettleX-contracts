require("dotenv").config({ path: __dirname + "/./../.env" });
module.exports = {
    "RPC_URL":process.env.BASE_RPC_URL,
    "NETWORK":process.env.NETWORK,
    "SCAN_API_KEY":process.env.BASE_API_KEY,
    "ACCOUNT_PRIVATE_KEY":process.env.BASE_ACCOUNT_PRIVATE_KEY,
    "OPTIMIZER_RUNS":process.env.BASE_OPTIMIZER_RUNS,
    "OPTIMIZER_FLAG":process.env.BASE_OPTIMIZER_FLAG,
}
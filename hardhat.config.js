require("@nomicfoundation/hardhat-toolbox");
require("@nomicfoundation/hardhat-verify");
require('hardhat-abi-exporter');
require("dotenv").config();
const CONFIG = require("./config");

const defaultKey =
  "0000000000000000000000000000000000000000000000000000000000000000";

module.exports = {
  sourcify: {
    enabled: true
  },
  etherscan: {
    apiKey: CONFIG.SCAN_API_KEY,
  },
  gasReporter: {
    enabled: false,
  },
  solidity: {
    compilers: [
      {
        version: "0.8.24",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
    ],
  },
  defaultNetwork: "hardhat",
  networks: {
    mainnet: {
      url: CONFIG.RPC_URL || "",
      accounts: [CONFIG.ACCOUNT_PRIVATE_KEY || defaultKey],
    },
    base:{
      url: CONFIG.RPC_URL || "",
      accounts: [CONFIG.ACCOUNT_PRIVATE_KEY || defaultKey],
    },
    sepolia: {
      url: CONFIG.RPC_URL || "",
      accounts: [CONFIG.ACCOUNT_PRIVATE_KEY || defaultKey],
    },
    hardhat: {
      chainId: 1337,
    },
  },
  abiExporter: [
    {
      path: "./abi",
      runOnCompile: true,
      clear: true,
      flat: true,
      spacing: 2,
      format: "json",
    },
  ],
};

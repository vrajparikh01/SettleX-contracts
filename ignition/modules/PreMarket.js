const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("PreMarket", (m) => {

  const OpenMarket = m.contract("PreMarket");

  return { OpenMarket };
});

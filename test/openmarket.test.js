const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OpenMarket", function () {

  let OpenMarket, StableCoin, TestToken, deployer, alice, bob, broker, client;
  const tradeStatus = {
    OPEN: 0,
    CLOSED: 1,
    CANCELLED: 2
  };
  const commission = 10;
  const brokerFee = 2;
  this.beforeAll(async function () {

    const [_deployer, _alice, _bob, _broker, _client] = await ethers.getSigners();

    const _stableCoin = await ethers.deployContract("TestToken", ["StableCoin", "STC"]);
    const _testToken = await ethers.deployContract("TestToken", ["TestToken", "TTC"]);
    
    const _openMarket = await ethers.deployContract("OpenMarket");

    deployer = _deployer;
    alice = _alice;
    bob = _bob;

    StableCoin = _stableCoin;
    TestToken = _testToken;
    OpenMarket = _openMarket;
    broker = _broker;
    client = _client;
  })


  it("mint token to alice and bob", async function () {

    await StableCoin.connect(deployer).mint(alice.address, ethers.parseEther("1000"));
    await StableCoin.connect(deployer).mint(bob.address, ethers.parseEther("1000"));
    await TestToken.connect(deployer).mint(alice.address, ethers.parseEther("1000"));
    await TestToken.connect(deployer).mint(bob.address, ethers.parseEther("1000"));

    expect(await StableCoin.balanceOf(alice.address)).to.equal(ethers.parseEther("1000"));
    expect(await StableCoin.balanceOf(bob.address)).to.equal(ethers.parseEther("1000"));
    expect(await TestToken.balanceOf(alice.address)).to.equal(ethers.parseEther("1000"));
    expect(await TestToken.balanceOf(bob.address)).to.equal(ethers.parseEther("1000"));
  });

  it("owner should set commission information", async function () {
    await OpenMarket.connect(deployer).setCommissionToken(1, commission);

    const info = await OpenMarket.getCommissionInformation();
    expect(Number(info[0])).to.equal(1);
    expect(Number(info[1])).to.equal(commission);
  })

  it("only owner should set commission information", async function () {
    await expect(OpenMarket.connect(bob).setCommissionToken(1, 10)).to.reverted;
  })

  it("commission percentage should be lower than 100", async function () {
    await expect(OpenMarket.connect(deployer).setCommissionToken(1, 101)).to.revertedWith("Commission percentage must be lower than 100");
  })

  it("alice should add trade for sell", async function () {

    await TestToken.connect(alice).approve(await OpenMarket.getAddress(), ethers.parseEther("10"));

    const trade = {
      OfferTokenAmount: ethers.parseEther("10"),
      ReciveTokenAmount: ethers.parseEther("10"),
      OfferToken: await TestToken.getAddress(),
      WantToReceiveToken: await StableCoin.getAddress(),
      trader: alice.address,
      lotType: 0,
      amtSold: 0,
      status: tradeStatus.OPEN,
      isBroker: false,
      brokerFee: 2,
      brokerAddress: alice.address,
      timestamp: 123
    }

    await OpenMarket.connect(alice).addTrade(trade);
    const trades = await OpenMarket.connect(alice).getMyTrades();

    expect(trades[0][0]).to.equal(trade.OfferTokenAmount);
    expect(await OpenMarket.getLastAddedTradeIndex(alice.address)).to.equal(0);
  })

  it("bob should buy trade form alice", async function () {
    const balanceOfAliceBefore = await StableCoin.balanceOf(alice.address);
    await StableCoin.connect(bob).approve(await OpenMarket.getAddress(), ethers.parseEther("10"));
    await OpenMarket.connect(bob).executeTrade(0, ethers.parseEther("10"), ethers.parseEther("10"));
    const trades = await OpenMarket.connect(alice).getMyTrades();

    const balanceOfAliceAfter = await StableCoin.balanceOf(alice.address);

    const balanceOfContract = await StableCoin.balanceOf(await OpenMarket.getAddress());
    const commissionAmount = ethers.parseEther(((10 * commission) / 100).toString());
    expect(balanceOfAliceAfter).to.equal((balanceOfAliceBefore + ethers.parseEther("10")) - balanceOfContract);
    expect(balanceOfContract).to.equal(commissionAmount);
    expect(Number(trades[0][7])).to.equal(1);
  })

  it("bob should add trade for buy", async function () {
    await StableCoin.connect(bob).approve(await OpenMarket.getAddress(), ethers.parseEther("10"));
    const trade = {
      OfferTokenAmount: ethers.parseEther("10"),
      ReciveTokenAmount: ethers.parseEther("10"),
      OfferToken: await StableCoin.getAddress(),
      WantToReceiveToken: await TestToken.getAddress(),
      trader: bob.address,
      lotType: 0,
      amtSold: 0,
      status: tradeStatus.OPEN,
      isBroker: false,
      brokerFee: 2,
      brokerAddress: alice.address,
      timestamp: 123
    } 
    await OpenMarket.connect(bob).addTrade(trade);
    const trades = await OpenMarket.connect(bob).getMyTrades();
    expect(trades[0][0]).to.equal(trade.OfferTokenAmount);
    expect(await OpenMarket.getLastAddedTradeIndex(bob.address)).to.equal(1);
  })

  it("should get receivable amount", async function () {
    const amount = await OpenMarket.connect(alice).getReceivableAmount(1);
    expect(amount).to.equal(ethers.parseEther("9"));
  })

  it("alice should buy trade form bob", async function () {
    const balanceOfBobBefore = await TestToken.balanceOf(bob.address);

    await TestToken.connect(alice).approve(await OpenMarket.getAddress(), ethers.parseEther("10"));
    await OpenMarket.connect(alice).executeTrade(1, ethers.parseEther("10"), ethers.parseEther("10"));
    
    const trades = await OpenMarket.connect(bob).getMyTrades();
    const balanceOfbobAfter = await TestToken.balanceOf(bob.address);

    const balanceOfContract = await TestToken.balanceOf(await OpenMarket.getAddress());

    const commissionAmount = ethers.parseEther(((10 * commission) / 100).toString());
    
    expect(balanceOfbobAfter).to.equal((balanceOfBobBefore + ethers.parseEther("10")) - commissionAmount);
    expect(balanceOfContract).to.equal(commissionAmount);
    expect(Number(trades[0][7])).to.equal(1);
  })

  it("owner should cancel the trade", async function () {
    await StableCoin.connect(bob).approve(await OpenMarket.getAddress(), ethers.parseEther("10"));
    const trade = {
      OfferTokenAmount: ethers.parseEther("10"),
      ReciveTokenAmount: ethers.parseEther("10"),
      OfferToken: await StableCoin.getAddress(),
      WantToReceiveToken: await TestToken.getAddress(),
      trader: bob.address,
      lotType: 0,
      amtSold: 0,
      status: tradeStatus.OPEN,
      isBroker: false,
      brokerFee: 2,
      brokerAddress: alice.address,
      timestamp: 123
    } 
    await OpenMarket.connect(bob).addTrade(trade);

    await OpenMarket.connect(bob).cancelTrade(2);
    const trades = await OpenMarket.connect(bob).getMyTrades();

    expect(Number(trades[1][7])).to.equal(2);
  })

  it("sholud not add trade ", async function () {
    const trade = {
      OfferTokenAmount: ethers.parseEther("0"),
      ReciveTokenAmount: ethers.parseEther("10"),
      OfferToken: await StableCoin.getAddress(),
      WantToReceiveToken: await TestToken.getAddress(),
      trader: bob.address,
      lotType: 0,
      amtSold: 0,
      status: tradeStatus.OPEN,
      isBroker: false,
      brokerFee: 2,
      brokerAddress: alice.address,
      timestamp: 123
    }

    await expect(OpenMarket.connect(bob).addTrade(trade)).to.be.revertedWith("Offer token amount must be greater than 0");

    trade.OfferTokenAmount = ethers.parseEther("10");
    trade.ReciveTokenAmount = ethers.parseEther("0");
    await expect(OpenMarket.connect(bob).addTrade(trade)).to.be.revertedWith("Receive token amount must be greater than 0");

    trade.OfferToken = ethers.ZeroAddress;
    trade.ReciveTokenAmount = ethers.parseEther("10");
    await expect(OpenMarket.connect(bob).addTrade(trade)).to.be.revertedWith("Offer token address cannot be 0");

    trade.OfferToken = await StableCoin.getAddress();
    trade.WantToReceiveToken = ethers.ZeroAddress;
    await expect(OpenMarket.connect(bob).addTrade(trade)).to.be.revertedWith("Receive token address cannot be 0");

    trade.WantToReceiveToken = await TestToken.getAddress();
    trade.OfferToken = await TestToken.getAddress();
    await expect(OpenMarket.connect(bob).addTrade(trade)).to.be.revertedWith("Offer and receive token address cannot be same");

    trade.OfferToken = await StableCoin.getAddress();
    await expect(OpenMarket.connect(deployer).addTrade(trade)).to.be.revertedWith("Insufficient balance");

    await expect(OpenMarket.connect(bob).addTrade(trade)).to.be.revertedWith("Insufficient Allowance");
    
  })

  it("closed trade should not be cancel", async function () {
    await expect(OpenMarket.connect(bob).cancelTrade(1)).to.be.revertedWith("Trade already closed");
  })

  it("trade should be canceled", async function () {
    await StableCoin.connect(bob).approve(await OpenMarket.getAddress(), ethers.parseEther("10"));
    const trade = {
      OfferTokenAmount: ethers.parseEther("10"),
      ReciveTokenAmount: ethers.parseEther("10"),
      OfferToken: await StableCoin.getAddress(),
      WantToReceiveToken: await TestToken.getAddress(),
      trader: bob.address,
      lotType: 0,
      amtSold: 0,
      status: tradeStatus.OPEN,
      isBroker: false,
      brokerFee: 2,
      brokerAddress: alice.address,
      timestamp: 123
    } 
    await OpenMarket.connect(bob).addTrade(trade);
    const tradesIndex = await OpenMarket.connect(bob).getLastAddedTradeIndex(bob.address);

    await expect(OpenMarket.connect(deployer).cancelTrade(tradesIndex)).to.be.revertedWith("Only trade owner can cancel the trade");

    await OpenMarket.connect(bob).cancelTrade(tradesIndex);

    await expect(OpenMarket.connect(bob).cancelTrade(tradesIndex)).to.be.revertedWith("Trade already cancelled");
  })

  it("should not execute trade because balance is not enough", async function () {
    await StableCoin.connect(bob).approve(await OpenMarket.getAddress(), ethers.parseEther("10"));
    const trade = {
      OfferTokenAmount: ethers.parseEther("10"),
      ReciveTokenAmount: ethers.parseEther("10"),
      OfferToken: await StableCoin.getAddress(),
      WantToReceiveToken: await TestToken.getAddress(),
      trader: bob.address,
      lotType: 0,
      amtSold: 0,
      status: tradeStatus.OPEN,
      isBroker: false,
      brokerFee: 2,
      brokerAddress: alice.address,
      timestamp: 123
    } 
    await OpenMarket.connect(bob).addTrade(trade);
    const tradesIndex = await OpenMarket.connect(bob).getLastAddedTradeIndex(bob.address);
    await expect(OpenMarket.connect(deployer).executeTrade(tradesIndex, ethers.parseEther("10"), ethers.parseEther("10"))).to.be.revertedWith("Insufficient balance");
  })

  it("should execute trade because trade is closed", async function () {
    await expect(OpenMarket.connect(alice).executeTrade(1, ethers.parseEther("10"), ethers.parseEther("10"))).to.be.revertedWith("Trade already closed");
  })

  it("should execute trade because trade is closed", async function () {
    await expect(OpenMarket.connect(alice).executeTrade(3, ethers.parseEther("10"), ethers.parseEther("10"))).to.be.revertedWith("Trade already cancelled");
  })

  it("should execute trade because insufficient allowance", async function () {
    await expect(OpenMarket.connect(alice).executeTrade(4, ethers.parseEther("10"), ethers.parseEther("10"))).to.be.revertedWith("Insufficient allowance");
  })

  it("should withdraw collected fees", async function () {
    const balanceBefore = await StableCoin.balanceOf(await OpenMarket.getAddress());
    await OpenMarket.connect(deployer).withdrawCollectedFund(await StableCoin.getAddress());

    const balanceAfter = await StableCoin.balanceOf(deployer.address);
    expect(balanceAfter).to.equal(balanceBefore);
  })

  it("only owner can withdraw collected fees", async function () {
    await expect(OpenMarket.connect(alice).withdrawCollectedFund(await StableCoin.getAddress())).to.be.reverted;
  })

  it("should revert with No fund to withdraw", async function () {
    await expect(OpenMarket.connect(deployer).withdrawCollectedFund(await StableCoin.getAddress())).to.be.revertedWith("No fund to withdraw");
  })

  it("should revert with Token address cannot be 0", async function () {
    await expect(OpenMarket.connect(deployer).withdrawCollectedFund(ethers.ZeroAddress)).to.be.revertedWith("Token address cannot be 0");
  })

  it("owner should set commission information", async function () {
    await OpenMarket.connect(deployer).setCommissionToken(0, commission);

    const info = await OpenMarket.getCommissionInformation();
    expect(Number(info[0])).to.equal(0);
    expect(Number(info[1])).to.equal(10);
  })

  it("should take commission from offer token", async function () {

    await StableCoin.connect(bob).approve(await OpenMarket.getAddress(), ethers.parseEther("10"));
    const trade = {
      OfferTokenAmount: ethers.parseEther("10"),
      ReciveTokenAmount: ethers.parseEther("10"),
      OfferToken: await StableCoin.getAddress(),
      WantToReceiveToken: await TestToken.getAddress(),
      trader: bob.address,
      lotType: 0,
      amtSold: 0,
      status: tradeStatus.OPEN,
      isBroker: false,
      brokerFee: 2,
      brokerAddress: alice.address,
      timestamp: 123
    } 
    await OpenMarket.connect(bob).addTrade(trade);
    const tradeIndex = await OpenMarket.connect(bob).getLastAddedTradeIndex(bob.address);
    const balanceOfAliceBeforeInStable = await StableCoin.balanceOf(alice.address);

    expect(await OpenMarket.connect(alice).getReceivableAmount(tradeIndex)).to.equal(ethers.parseEther("9"));

    await TestToken.connect(alice).approve(await OpenMarket.getAddress(), ethers.parseEther("10"));
    await OpenMarket.connect(alice).executeTrade(tradeIndex, ethers.parseEther("10"), ethers.parseEther("10"));
    
    const trades = await OpenMarket.connect(bob).getMyTrades();

    const balanceOfContractInStable = await StableCoin.balanceOf(await OpenMarket.getAddress());
    
    const balanceOfAliceAfterInStable = await StableCoin.balanceOf(alice.address);
    
    expect(balanceOfAliceAfterInStable).to.equal(ethers.parseEther("1028"));
    expect(balanceOfContractInStable).to.equal(ethers.parseEther("1"));


    const commissionAmount = ethers.parseEther(((10 * commission) / 100).toString());
    
    expect(balanceOfAliceAfterInStable).to.equal((balanceOfAliceBeforeInStable + ethers.parseEther("10")) - commissionAmount);
    expect(balanceOfContractInStable).to.equal(commissionAmount);

    expect(Number(trades[trades.length - 1][7])).to.equal(1);
  })

  // test for partial trade
  it("should add and execute partial trade", async function () {
    await StableCoin.connect(bob).approve(await OpenMarket.getAddress(), ethers.parseEther("10"));
    const balanceOfContractInStableBefore = await StableCoin.balanceOf(await OpenMarket.getAddress());

    const trade = {
      OfferTokenAmount: ethers.parseEther("10"),
      ReciveTokenAmount: ethers.parseEther("10"),
      OfferToken: await StableCoin.getAddress(),
      WantToReceiveToken: await TestToken.getAddress(),
      listingPrice: ethers.parseEther("1"),
      trader: bob.address,
      lotType: 1,
      amtSold: 0,
      status: tradeStatus.OPEN,
      isBroker: false,
      brokerFee: 2,
      brokerAddress: alice.address,
      timestamp: 123
    } 
    await OpenMarket.connect(bob).addTrade(trade);
    const tradeIndex = await OpenMarket.connect(bob).getLastAddedTradeIndex(bob.address);
    const balanceOfAliceBeforeInStable = await StableCoin.balanceOf(alice.address);


    await TestToken.connect(alice).approve(await OpenMarket.getAddress(), ethers.parseEther("5"));
    await OpenMarket.connect(alice).executeTrade(tradeIndex, ethers.parseEther("5"), ethers.parseEther("5"));

    const trades = await OpenMarket.connect(bob).getMyTrades();

    const balanceOfContractInStableAfter = await StableCoin.balanceOf(await OpenMarket.getAddress());
    const balanceOfAliceAfterInStable = await StableCoin.balanceOf(alice.address);

    const commissionAmount = ethers.parseEther(((5 * commission) / 100).toString());
    
    expect(balanceOfAliceAfterInStable).to.equal((balanceOfAliceBeforeInStable + ethers.parseEther("5")) - commissionAmount);
    expect(balanceOfContractInStableAfter).to.equal(balanceOfContractInStableBefore + ethers.parseEther("5") + commissionAmount);
    expect(Number(trades[trades.length - 1][7])).to.equal(0);
  });

  // test for broker
  it("alice should add trade for sell", async function () {

    await TestToken.connect(alice).approve(await OpenMarket.getAddress(), ethers.parseEther("10"));

    // transfer funds to broker and allow broker to spend funds
    await TestToken.connect(alice).transfer(client.address, ethers.parseEther("10"));
    await TestToken.connect(client).approve(await OpenMarket.getAddress(), ethers.parseEther("10"));

    const trade = {
      OfferTokenAmount: ethers.parseEther("10"),
      ReciveTokenAmount: ethers.parseEther("10"),
      OfferToken: await TestToken.getAddress(),
      WantToReceiveToken: await StableCoin.getAddress(),
      trader: client.address,
      lotType: 0,
      amtSold: 0,
      status: tradeStatus.OPEN,
      isBroker: true,
      brokerFee: brokerFee,
      brokerAddress: broker.address,
      timestamp: 123
    }

    await OpenMarket.connect(client).addTrade(trade);
    const trades = await OpenMarket.connect(client).getMyTrades();

    expect(trades[0][0]).to.equal(trade.OfferTokenAmount);
    expect(await OpenMarket.getLastAddedTradeIndex(client.address)).to.equal(0);
  })

  it("bob should buy trade form alice", async function () {
    const prevBalClient = await StableCoin.balanceOf(client.address);
    const prevBalBroker = await StableCoin.balanceOf(broker.address);
    const prevBalContract = await StableCoin.balanceOf(await OpenMarket.getAddress());

    await StableCoin.connect(bob).approve(await OpenMarket.getAddress(), ethers.parseEther("10"));
    await OpenMarket.connect(bob).executeTrade(0, ethers.parseEther("10"), ethers.parseEther("10"));
    const trades = await OpenMarket.connect(client).getMyTrades();
    console.log(trades);

    const afterBalClient = await StableCoin.balanceOf(client.address);
    const afterBalBroker = await StableCoin.balanceOf(broker.address);
    const afterBalContract = await StableCoin.balanceOf(await OpenMarket.getAddress());

    const brokerCommission = ethers.parseEther(((10 * brokerFee) / 100).toString());
    const otcCommission = ethers.parseEther(((10 * commission) / 100).toString());
    const totalCommission = brokerCommission + otcCommission;

    // check balance of alice, contract and broker
    expect(afterBalClient).to.equal((prevBalClient + ethers.parseEther("10")) - totalCommission);
    expect(afterBalBroker).to.equal(prevBalBroker + brokerCommission);
    expect(afterBalContract).to.equal(prevBalContract + otcCommission);
  })
});

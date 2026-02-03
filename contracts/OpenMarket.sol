// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/* 
 * @title OpenMarket
 * @notice A contract responsible for lock funds for trading
 */
contract OpenMarket is Ownable, ReentrancyGuard {

   //@notice Trade status
   enum TradeStatus {
      OPEN,
      CLOSED,
      CANCELLED
   }

   //@notice commission token
   enum CommisionToken {
      OFFER_TOKEN,
      RECEIVE_TOKEN
   }

   enum LotType {
      FULL,
      PARTIAL
   }
   
   //@notice Trade information
   struct Trades{
      uint256 OfferTokenAmount; // amount of token user willing to sell
      uint256 ReciveTokenAmount; // amount of token user willing to buy
      address OfferToken; // token address that user willing to sell
      address WantToReceiveToken; // token address that user want to receive
      address trader; // address of user
      LotType lotType; // type of lot full or partial
      uint256 amtSold; // amount of token sold
      uint256 status; // status of trade open, close or cancelled
      bool isBroker; // broker status
      uint256 brokerFee; // broker fee
      uint256 brokerFeeScale; // broker fee scale
      address brokerAddress; // address of recipiet which broker want to send token
      uint256 timestamp; // timestamp of trade
   }

   // @notice trade list
   Trades[] private trades;

   // @notice trade counter
   uint256 private tradeCounter = 0;

   // @notice store trade index based on trader
   mapping (address => uint256[]) private tradersTrade;

   // @notice store id of token that used for commission
   uint256 private commissionToken;

   // @notice store commission percentage
   uint256 private commissionPercentage;
   uint256 private scale;

   event TradeListed(Trades);
   event ExecuteTrade(address executedBy, uint256 tradeIndex, uint256 timestamp);
   event CancelTrade(uint256 tradeIndex, uint256 timestamp);

   constructor() Ownable(msg.sender) {}
   
   /**
   * @notice set commission token information
   * @param _type is type of commission token
   * @param _commissionPercentage is percentage of commission that must be lower than 100
   */
   function setCommissionToken(CommisionToken _type, uint256 _commissionPercentage, uint256 _scale) external nonReentrant onlyOwner{
      require(_scale > 0, "Scale must be greater than 0");
      commissionToken = uint256(_type);
      commissionPercentage = _commissionPercentage;
      scale = _scale;
   }

   /**
   * @notice whenever user want to add trade, this function will be called
   * @param _trade is contain trade information
   */
   function addTrade(Trades memory _trade) external nonReentrant {
      require(_trade.OfferTokenAmount > 0, "Offer token amount must be greater than 0");
      require(_trade.ReciveTokenAmount > 0, "Receive token amount must be greater than 0");
      require(_trade.OfferToken != address(0), "Offer token address cannot be 0");
      require(_trade.WantToReceiveToken != address(0), "Receive token address cannot be 0");
      require(_trade.OfferToken != _trade.WantToReceiveToken, "Offer and receive token address cannot be same");
      require(_trade.trader != address(0), "Trader address cannot be 0");
      require(_trade.brokerAddress != address(0), "Broker address cannot be 0");

      _trade.timestamp = block.timestamp;
      _trade.amtSold = 0;
      trades.push(_trade);
      tradeCounter += 1;
      tradersTrade[msg.sender].push(tradeCounter-1);

      require(IERC20(_trade.OfferToken).balanceOf(msg.sender) >= _trade.OfferTokenAmount, "Insufficient balance");
      require(IERC20(_trade.OfferToken).allowance(msg.sender, address(this)) >= _trade.OfferTokenAmount, "Insufficient Allowance");

      bool sucess = IERC20(_trade.OfferToken).transferFrom(msg.sender, address(this), _trade.OfferTokenAmount);
      require(sucess, "Transfer failed");

      emit TradeListed(_trade);
   }

   /**
    * @notice Execute a trade, whether fully or partially, based on the lot type.
    * @param _tradeIndex The index of the trade.
    * @param _offerAmount The amount of token user is willing to sell (set 0 for full lot).
    * @param _receiveAmount The amount of token user is willing to buy (set 0 for full lot).
    */
   function executeTrade(uint256 _tradeIndex, uint256 _offerAmount, uint256 _receiveAmount) external nonReentrant {
      Trades storage _trade = trades[_tradeIndex];
      
      // Check if the trade is full or partial
      bool isFullTrade = _trade.lotType == LotType.FULL;
      
      require(_trade.status != uint256(TradeStatus.CLOSED), "Trade already closed");
      require(_trade.status != uint256(TradeStatus.CANCELLED), "Trade already cancelled");

      uint256 offerTokenAmount;
      uint256 receiveTokenAmount;

      if (isFullTrade) {
         // Full trade execution
         offerTokenAmount = _trade.OfferTokenAmount;
         receiveTokenAmount = _trade.ReciveTokenAmount;
      } else {
         // Partial trade execution
         offerTokenAmount = _offerAmount;
         receiveTokenAmount = _receiveAmount;

         require(_trade.lotType == LotType.PARTIAL, "Trade is not a partial lot");
         require(_offerAmount > 0 && _offerAmount <= (_trade.OfferTokenAmount - _trade.amtSold), "Invalid offer amount");
      }

      // Ensure the buyer has sufficient balance and allowance
      require(IERC20(_trade.WantToReceiveToken).balanceOf(msg.sender) >= receiveTokenAmount, "Insufficient balance");
      require(IERC20(_trade.WantToReceiveToken).allowance(msg.sender, address(this)) >= receiveTokenAmount, "Insufficient allowance");

      bool isTokenReceivedInContract = IERC20(_trade.WantToReceiveToken).transferFrom(msg.sender, address(this), receiveTokenAmount);
      require(isTokenReceivedInContract, "ReceiveToken transfer failed during trade execution");
      uint256 receiveTokenCommission = receiveTokenAmount;

      if(_trade.isBroker){
         require(_trade.brokerAddress != address(0), "Broker address cannot be 0");
         require(_trade.brokerFee > 0, "Broker fee must be greater than 0");
         require(_trade.brokerFeeScale > 0, "Broker fee scale must be greater than 0");

         uint256 brokerFee = (receiveTokenAmount * _trade.brokerFee) / (_trade.brokerFeeScale * 100);
         receiveTokenAmount = receiveTokenAmount - brokerFee;

         // need to remove this and create a new function for withdraw broker fee
         bool successBrokerFee = IERC20(_trade.WantToReceiveToken).transfer(_trade.brokerAddress, brokerFee);
         require(successBrokerFee, "Broker fee transfer failed");
      }

      uint256 commissionAmount;
      uint256 commissionAmount2;
      // Calculate and deduct commission for offer or receive token
      if (commissionToken == uint256(CommisionToken.OFFER_TOKEN)) {
         commissionAmount = (offerTokenAmount * commissionPercentage) / (scale * 100);
         offerTokenAmount = offerTokenAmount - commissionAmount;
      }

      if (commissionToken == uint256(CommisionToken.RECEIVE_TOKEN)) {
         commissionAmount2 = (receiveTokenCommission * commissionPercentage) / (scale * 100);
         receiveTokenAmount = receiveTokenAmount - commissionAmount2;
      }

      // Perform the token transfers
      bool successReceiveToken = IERC20(_trade.WantToReceiveToken).transfer(_trade.trader, receiveTokenAmount);
      bool successOfferToken = IERC20(_trade.OfferToken).transfer(msg.sender, offerTokenAmount);
      require(successReceiveToken && successOfferToken, "Token transfer failed");

      // transfer commission to owner
      if (commissionToken == uint256(CommisionToken.OFFER_TOKEN)) {
         bool successCommission = IERC20(_trade.OfferToken).transfer(owner(), commissionAmount);
         require(successCommission, "Commission transfer failed");
      }

      if (commissionToken == uint256(CommisionToken.RECEIVE_TOKEN)) {
         bool successCommission = IERC20(_trade.WantToReceiveToken).transfer(owner(), commissionAmount2);
         require(successCommission, "Commission transfer failed");
      }

      // Update the trade status and amtSold
      if (!isFullTrade) {
         _trade.amtSold += _offerAmount;
         if (_trade.amtSold == _trade.OfferTokenAmount) {
               _trade.status = uint256(TradeStatus.CLOSED); 
         }
      } else {
         _trade.status = uint256(TradeStatus.CLOSED);
      }

      emit ExecuteTrade(msg.sender, _tradeIndex, block.timestamp);
   }

   /**
   * @notice this function will return list of trades based on msg.sender
   */
   function getMyTrades() external view returns (Trades[] memory) {
      uint256 totalTrades = tradersTrade[msg.sender].length;
      Trades[] memory _trades = new Trades[](totalTrades);
      for(uint256 i = 0; i < totalTrades; i++) {
         _trades[i] = trades[tradersTrade[msg.sender][i]];
      }
      return _trades;
   }

   /**
   * @notice this function will return index of last added trade
   * @param _trader is address of trader
   */
   function getLastAddedTradeIndex(address _trader) external view returns (uint256) {
      return tradersTrade[_trader][tradersTrade[_trader].length-1];
   }

   /**
   * @notice this function will return commission information
   */
   function getCommissionInformation() external view returns (uint256, uint256, uint256) {
      return (commissionToken, commissionPercentage, scale);
   }
}

require("dotenv").config();

const Storage = require("node-storage");
const moment = require("moment");
const client = require("./services/binance");
const { log, logColor, colors } = require("./utils/logger");
const { parse } = require("dotenv");

const MARKET1 = process.argv[2];
const MARKET2 = process.argv[3];
const MARKET = MARKET1 + MARKET2;
const BUY_ORDER_AMOUNT = process.argv[4];

/* console.log("MARKET: ", MARKET);
console.log("BUY_ORDER_AMOUNT: ", BUY_ORDER_AMOUNT); */

const store = new Storage(`./data/{MARKET}.json`);

//functions

// wait execution time of the bot
const sleep = (timeMs) => new Promise((resolve) => setTimeout(resolve, timeMs));

async function _balances() {
  console.log(client);
  await client.useServerTime();
  return await client.balance();
}

function _newPriceReset(_market, balance, price) {
  // this line said if the price is not set, set it to 0
  const market = _market == 1 ? MARKET1 : MARKET2;

  if (!parseFloat(store.get(`${market.toLowerCase}_balance`))) {
    store.put(`start_price`, price);
  }
}

// this function will update the balance of the market
async function _updateBalances() {
  // getting the balances from the api
  const balances = await _balances();
  // updating the balance of the first market
  store.put(
    `${MARKET1.toLowerCase}_balance`,
    parseFloat(balances[MARKET1].available)
  );
  // updating the balance of the second market
  store.put(
    `${MARKET2.toLowerCase}_balance`,
    parseFloat(balances[MARKET2].available)
  );
}

//calculating profits
async function _calculateProfits() {
  const orders = store.get("orders");

  const sold = orders.filters((order) => {
    return order.status == "sold";
  });

  // total profits
  const totalSoldProfits =
    sold.length > 0
      ? sold
          .map((order) => order.profit)
          .reduce((prev, next) => {
            pasrseFloat(prev) + parseFloat(next);
          })
      : 0;

  store.put("profits", totalSoldProfits + parseFloat(store.get("profits")));
}

// function to print the profits
function _logProfits(price) {
  const profits = parseFloat(store.get("profits"));

  var isGainer = profits > 0 ? 1 : profits < 0 ? 2 : 0;

  logColor(
    isGainer == 1 ? colors.green : isGainer == 2 ? colors.red : colors.gray,
    `Profits: ${profits.toFixed(4)} ${MARKET2}`
  );

  log(`Global fees: ${parseFloat(store.get("fees")).toFixed(4)} ${MARKET2}`);

  // know current balance
  const m1Balance = parseFloat(store.get(`${MARKET1.toLowerCase}_balance`));
  const m2Balance = parseFloat(store.get(`${MARKET2.toLowerCase}_balance`));

  // initial balance and current balance
  const initialBalance = parseFloat(
    store.get(`initial_${MARKET2.toLowerCase}_balance`)
  );
  logColor(
    colors.gray,
    `Balance: ${m1Balance.toFixed(2)} ${MARKET1}, ${m2Balance.toFixed(
      2
    )} ${MARKET2}`
  );
  logColor(
    colors.gray,
    `Current balance: ${parseFloat(m1Balance * price + m2Balance).toFixed(
      2
    )} ${MARKET2}, Initial balance: ${initialBalance.toFixed(2)} ${MARKET2}`
  );
}

async function init() {
  if (process.argv[5] != "resume") {
    const startTime = Date.now();

    store.put("start_time", startTime);

    const price = await client.prices(MARKET);
    console.log("price: ", price);

    store.put("start_price", parseFloat(price[MARKET]));
    store.put("orders", []);
    store.put("profits", 0);
    store.put("fees", 0);

    // get the balances from the api
    const balances = await _balances();
    // updating the balance of the first market
    store.put(
      `${MARKET1.toLowerCase}_balance`,
      parseFloat(balances[MARKET1].available)
    );
    // updating the balance of the second market
    store.put(
      `${MARKET2.toLowerCase}_balance`,
      parseFloat(balances[MARKET2].available)
    );

    // initial balance
    store.put(
      `initial_${MARKET1.toLowerCase}_balance`,
      store.get(`${MARKET1.toLowerCase}_balance`)
    );

    store.put(
      `initial_${MARKET2.toLowerCase}_balance`,
      store.get(`${MARKET2.toLowerCase}_balance`)
    );
  }

  broadcast();
}

async function broadcast() {
  // loop to get the price every 5 seconds
  while (true) {
    try {
      // get the price of the market
      const mPrice = parseFloat((await client.prices(MARKET))[MARKET]);
      // if the price exists
      if (mPrice) {
        // start
        const startPrice = parseFloat(store.get("start_price"));

        const marketPrice = mPrice;
        console.clear();

        log(`Running time: ${elapsedTime()}`);
        log("=============================");
        log("=============================");

        _logProfits(marketPrice);
        log("=============================");
        log(`prev price: ${startPrice}`);
        log(`current price: ${marketPrice}`);

        // if the price is < than the start price
        if (marketPrice < startPrice) {
          var factor = startPrice - marketPrice;
          // movement percentage
          var percent = parseFloat((100 * factor) / startPrice).toFixed(2);
          logColor(colors.red, `Price down: -${percent}%`);
          store.put("percent", `-$${parseFloat(percent).toFixed(3)}`);

          // reBuy
          if (percent >= process.env.PRICE_PERCENT) {
            await _buy(marketPrice, BUY_ORDER_AMOUNT);
          }
        } else {
          var factor = startPrice - marketPrice;
          // movement percentage
          var percent = parseFloat((100 * factor) / marketPrice).toFixed(2);

          logColor(colors.green, `Price up: +${percent}%`);
          store.put("percent", `+$${parseFloat(percent).toFixed(3)}`);

          await _sell(marketPrice);
        }

        const orders = store.get("orders");
        if (orders.length > 0) {
          const bOrder = orders[orders.length - 1];
          log(`Last buy order`);
          log("=============================");
          log(`Buy price: ${bOrder.buy_price}`);
          log(`Sell price: ${bOrder.sell_price}`);
          logColor(
            colors.green,
            `Expected profit: ${parseFloat(
              bOrder.amount * bOrder.sell_price -
                bOrder.amount * bOrder.buy_price -
                bOrder.buy_fee
            ).toFixed(2)}`
          );
          log(`=============================`);
        }
      } // end if price exists condition
    } catch (error) {
      await sleep(process.env.SLEEP_TIME);
    }
  }
} // end broadcast function

init();

async function _buy(price, amount) {
  //ask if there is enough balance to buy
  if (
    parseFloat(store.get(`${MARKET2.toLowerCase()}_balance`)) >=
    BUY_ORDER_AMOUNT
  ) {
    var orders = store.get("orders");
    var factor = (process.env.PRICE_PERCENT * price) / 100;

    const order = {
      buy_price: price,
      amount,
      sell_price: price + factor,
      sold_price: 0,
      status: "pending",
      profit: 0,
      buy_fee,
      sell_fee,
    };

    log(`Buying ${MARKET1}
      ==================
      amountIn: ${parseFloat(BUY_ORDER_AMOUNT * price).toFixed(2)} ${MARKET2}
      amountOut: ${parseFloat(BUY_ORDER_AMOUNT).toFixed(2)} ${MARKET1}
    `);

    const res = await client.marketBuy(MARKET, order.amount);

    // if the order is filled
    if (res && res.status == "FILLED") {
      order.status = "bought";
      order.id = res.orderId;
      order.buy_fee = parseFloat(await getFess(res.fill[0]));
      store.put("fees", parseFloat(store.get("fees")) + order.buy_fee);
      order.buy_price = parseFloat(res.fills[0].price);

      orders.push(order);

      store.put("start_price", order.buy_price);

      await _updateBalances();

      logColor(colors.green, `=============================`);
      logColor(
        colors.green,
        `Bought ${BUY_ORDER_AMOUNT} ${MARKET1} for ${parseFloat(
          BUY_ORDER_AMOUNT * price
        ).toFixed(2)} ${MARKET2} price: ${order.buy_price}\n`
      );
      logColor(colors.green, `=============================`);

      await _calculateProfits();
    } //close if
    else {
      _newPriceReset(2, BUY_ORDER_AMOUNT * price, price);
    }
  } //close main if
  else {
    _newPriceReset(2, BUY_ORDER_AMOUNT * price, price);
  }
} //close buy function

async function _sell(price) {
  const orders = store.get("orders");
  // array to store the orders to sell
  const toSold = [];

  // loop to get the last order
  for (let i = 0; i < orders.length; i++) {
    var order = orders[i];
    // if the order is bought and not sold
    if (price >= order.sell_price) {
      order.sold_price = price;
      order.status = "selling";
      toSold.push(order);
    } // close if
  } // close for loop

  // if there are orders to sell
  if (toSold.length > 0) {
    const totalAmount = parseFloat(
      toSold
        .map((order) => order.amount)
        .reduce((prev, next) => parseFloat(prev) + parseFloat(next))
    );

    if (
      totalAmount > 0 &&
      parseFloat(order.get(`${MARKET1.toLowerCase()}_balance`)) >= totalAmount
    ) {
      log(`Selling ${MARKET1}
        ==================
        amountIn: ${totalAmount.toFixed(2)} ${MARKET1}
        amountOut: ${parseFloat(totalAmount * price).toFixed(2)} ${MARKET1}
      `);

      const res = await client.marketSell(MARKET, totalAmount);

      if (res && res.status == "FILLED") {
        const _price = parseFloat(res.fills[0].price);

        for (var i = 0; i < orders.length; i++) {
          var order = orders[i];

          for (j = 0; i < toSold.length; j++) {
            if (order.id == toSold[j].id) {
              toSold[j].profit =
                parseFloat(toSold[j].amount) * _price -
                parseFloat(toSold[j].amount) * pasrseFloat(toSold[j].buy_price);

              toSold[j].profit -= order.sell_fee + order.buy_fee;
              toSold[j].sell_fee = parseFloat(await getFess(res.fill[0]));
              toSold[j].status = "sold";
              orders[i] = toSold[j];

              store.put(
                "fees",
                parseFloat(store.get("fees")) + orders[i].sell_fee
              );
            }
          }
        }

        store.put("start_price", _price);
        await _updateBalances();

        logColor(colors.red, `=============================`);
        logColor(
          colors.red,
          `Sold ${totalAmount} ${MARKET1} for ${parseFloat(
            totalAmount * _price
          ).toFixed(2)} ${MARKET2} price: ${_price}\n`
        );
        logColor(colors.red, `=============================`);

        await _calculateProfits();

        var i = orders.length;

        while (i--) {
          if (orders[i].status == "sold") {
            orders.splice(i, 1);
          }
        }
      } else {
        store.put("start_price", price);
      }
    } else {
      store.put("start_price", price);
    }
  } else {
    store.put("start_price", price);
  }
} // close sell function

async function getFess({ commission, commissionAsset }) {
  const market = `${commissionAsset}USDT`;
  const price = parseFloat((await client.prices(market))[market]);

  return price * commission;
}

const elapsedTime = () => {
  // get the difference between the start time and now
  const diff = Date.now() - store.get("start_time");
  // return the difference in a human readable format
  return moment.utc(diff).format("HH:mm:ss");
};

/* logColor(colors.green, "Bot started");
//console.log("elapsedTime: ", elapsedTime());
_logProfits(); */

//_newPriceReset();

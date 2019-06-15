const request = require('request')
const moment = require("moment")

var NodeHelper = require("node_helper")

String.prototype.hashCode = function() {
  var hash = 0
  if (this.length == 0) {
    return hash
  }
  for (var i = 0; i < this.length; i++) {
    var char = this.charCodeAt(i)
    hash = ((hash<<5)-hash)+char
    hash = hash & hash
  }
  return hash
}

module.exports = NodeHelper.create({
  start: function() {
    this.config = null
    this.pooler = []
    this.pooler2 = []
    this.doneFirstPooling = false
    this.doneFirstPooling = false
  },

  socketNotificationReceived: function(noti, payload) {
    if (noti == "INIT") {
      this.config = payload
      console.log("[AVSTOCK] Initialized.")
    }
    if (noti == "START") {
      if (this.pooler.length == 0) {
        this.prepareScan()
      }
      this.startPooling()
    }
  },

  startPooling: function() {
    // Since December 2018, Alphavantage changed API quota limit.(500 per day)
    // So, fixed interval is used. for the first cycle, 15sec is used.
    // After first cycle, 3min is used for interval to match 500 quota limits.
    // So, one cycle would be 3min * symbol length;
    var interval = 0
    if (this.config.premiumAccount) {
      interval = this.config.poolInterval
    } else {
      interval = (this.doneFirstPooling) ? 180000 : 15000
    }

    if (this.pooler.length > 0) {
      var symbol = this.pooler.shift()
      var type = this.pooler2.shift()
      this.callAPI(type, this.config, symbol, (noti, payload)=>{
        this.sendSocketNotification(noti, payload)
      })
    } else {
      this.doneFirstPooling = true
      this.prepareScan()
    }

    var timer = setTimeout(()=>{
      this.startPooling()
    }, interval)
  },

  callAPI: function(type, cfg, symbol, callback) {
    var url = ""
    console.log("type:" + type)
    if (type == 'S') {
      if (cfg.mode != "series") {
        url = "https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol="
      } else {
        url = "https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol="
      }
      url += symbol + "&apikey=" + cfg.apiKey

      request(url, (error, response, body)=>{
        //console.log("[AVSTOCK] API is called - ", symbol)
        var data = null
        if (error) {
          console.log("[AVSTOCK] API Error: ", error)
          return
        }
        data = JSON.parse(body)
        if (data.hasOwnProperty("Note")) {
          console.log("[AVSTOCK] Error: API Call limit exceeded.")
        }
        if (data.hasOwnProperty("Error Message")) {
          console.log("[AVSTOCK] Error:", data["Error Message"])
        }
        if (data["Global Quote"]) {
          if (!data["Global Quote"].hasOwnProperty("01. symbol")) {
            console.log("[AVSTOCK] Data Error: There is no available data for", symbol)
          }
          //console.log("[AVSTOCK] Response is parsed - ", symbol)
          var dec = this.config.decimals		//decimal Factor, converts decimals to numbers that needs to be multiplied for Math.round
          var result = {
            "symbol": data["Global Quote"]["01. symbol"],
            "open": parseFloat(data["Global Quote"]["02. open"]).toFixed(dec),
            "high": parseFloat(data["Global Quote"]["03. high"]).toFixed(dec),
            "low": parseFloat(data["Global Quote"]["04. low"]).toFixed(dec),
            "price": parseFloat(data["Global Quote"]["05. price"]).toFixed(dec),
            "volume": parseInt(data["Global Quote"]["06. volume"]).toLocaleString(),
            "day": data["Global Quote"]["07. latest trading day"],
            "close": parseFloat(data["Global Quote"]["08. previous close"]).toFixed(dec),
            "change": parseFloat(data["Global Quote"]["09. change"]).toFixed(dec),
            "changeP": parseFloat(data["Global Quote"]["10. change percent"]).toFixed(dec)+"%",
            "requestTime": moment().format(cfg.timeFormat),
            "hash": symbol.hashCode()
          }
          callback('UPDATE', result)
        } else if (data["Time Series (Daily)"]) {
          //console.log("[AVSTOCK] Response is parsed - ", symbol)
          var series = data["Time Series (Daily)"]
          var keys = Object.keys(series)
          var dayLimit = (cfg.chartDays > 90) ? 90 : cfg.chartDays
          var keys = keys.sort().reverse().slice(0, dayLimit)
          var ts = []
          for (k in keys) {
            var index = keys[k]
            var item = {
              "symbol": symbol,
              "date": index,
              "open": series[index]["1. open"],
              "high": series[index]["2. high"],
              "low": series[index]["3. low"],
              "close": series[index]["4. close"],
              "volume": series[index]["5. volume"],
              "hash" : symbol.hashCode(),
              "requestTime": moment().format(cfg.timeFormat),
              "candle": null
            }
            item.candle = ((item.close - item.open) >= 0) ? "up" : "down"
            ts.push(item)
          }
          callback('UPDATE_SERIES', ts)
        }
      })
   }
   else if (type == 'C') {
     if (cfg.mode != "series") {
       url = "https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency="
       url += symbol + "&to_currency=USD&apikey=" + cfg.apiKey      
       console.log("3 here: "+url)
    }
    else {
      url = "https://www.alphavantage.co/query?function=DIGITAL_CURRENCY_DAILY&symbol="
      url += symbol + "&market=USD&apikey=" + cfg.apiKey
      console.log("4 here: "+url)
    }
    request(url, (error, response, body)=>{
      //console.log("[AVSTOCK] API is called - ", symbol)
      var data = null
      if (error) {
        console.log("3: [AVSTOCK] API Error: ", error)
        return
      }
      data = JSON.parse(body)
      //console.log(data)
      if (data.hasOwnProperty("Note")) {
        console.log("[AVSTOCK] Error: API Call limit exceeded.")
      }
      if (data.hasOwnProperty("Error Message")) {
        console.log("4: [AVSTOCK] Error:", data["Error Message"])
      }
      if (data["Realtime Currency Exchange Rate"]) {
        if (!data["Realtime Currency Exchange Rate"].hasOwnProperty("1. From_Currency Code")) {
          console.log("[AVSTOCK] Data Error: There is no available data for", symbol)
        }
        //console.log("[AVSTOCK] Response is parsed - ", symbol)
        var dec = this.config.decimals		//decimal Factor, converts decimals to numbers that needs to be multiplied for Math.round
        var result = {
          "symbol": data["Realtime Currency Exchange Rate"]["1. From_Currency Code"],
          "name": data["Realtime Currency Exchange Rate"]["2. From_Currency Name"], // open
          "toCode": data["Realtime Currency Exchange Rate"]["3. To_Currency Code"], // high
          "toName": data["Realtime Currency Exchange Rate"]["4. To_Currency Name"], // low
          "price": parseFloat(data["Realtime Currency Exchange Rate"]["5. Exchange Rate"]).toFixed(dec), // price
          "day": data["Realtime Currency Exchange Rate"]["6. Last Refreshed"], // volume
          "zone": data["Realtime Currency Exchange Rate"]["7. Time Zone"], // day
          "bPrice": data["Realtime Currency Exchange Rate"]["8. Bid Price"], // close
          "aPrice": data["Realtime Currency Exchange Rate"]["9. Ask Price"], // change
          "requestTime": moment().format(cfg.timeFormat),
          "hash": symbol.hashCode()
        }
        //console.log(result)
        callback('UPDATE', result)
      } else if (data["Time Series (Digital Currency Daily)"]) {
        //console.log("[AVSTOCK] Response is parsed - ", symbol)
        var series = data["Time Series (Digital Currency Daily)"]
        var keys = Object.keys(series)
        var dayLimit = (cfg.chartDays > 90) ? 90 : cfg.chartDays
        var keys = keys.sort().reverse().slice(0, dayLimit)
        var ts = []
        for (k in keys) {
          var index = keys[k]
          var item = {
            "symbol": symbol,
            "date": index,
            "open1": series[index]["1a. open (USD)"],
            "open2": series[index]["1b. open (USD)"],
            "high1": series[index]["2a. high (USD)"],
            "high2": series[index]["2b. high (USD)"],
            "low1": series[index]["3a. low (USD)"],
            "low2": series[index]["3b. low (USD)"],
            "close1": series[index]["4a. close (USD)"],
            "close2": series[index]["4b. close (USD)"],
            "volume": series[index]["5. volume"],
            "cap": series[index]["6. market cap (USD)"],
            "hash" : symbol.hashCode(),
            "requestTime": moment().format(cfg.timeFormat),
            "candle": null
          }
          item.candle = ((item.close2 - item.open2) >= 0) ? "up" : "down"
          console.log("candle: "+item.candle)
          ts.push(item)
        }
        callback('UPDATE_SERIES', ts)
      }
    })
   }
  },

  prepareScan: function() {
    for (s in this.config.testsymbols) {
      var symbol = this.config.testsymbols[s]
      var symType = this.config.types[s]
//      console.log(symbol + " " + symType)
      this.pooler.push(symbol)
      this.pooler2.push(symType)
    }
  },
})

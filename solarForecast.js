const nodeplotlib = require('nodeplotlib')
const fetch = require('node-fetch')
const fs = require('fs')

const plot = nodeplotlib.plot
const Plot = nodeplotlib.Plot

const northDbFilePath = './fileDB/northPVForecast.json'
const eastDbFilePath = './fileDB/eastPVForecast.json'
const northPVResourceID = 'a0dd-e584-8bb2-e610'
const eastPVResourceID = '358d-0598-b48e-1560'
const solcastApiKey = 'xMAqCnaDhQmCW7BHDvoj0VGCBvKVuXZ8'

const northPVForecastURL = new URL(`https://api.solcast.com.au/rooftop_sites/${northPVResourceID}/forecasts?format=json&api_key=${solcastApiKey}`)
const eastPVForecastURL = new URL(`https://api.solcast.com.au/rooftop_sites/${eastPVResourceID}/forecasts?format=json&api_key=${solcastApiKey}`)

const timeBetweenUpdates = 60*60*1000 // one hour

const batteryKWh = 5*3550/1000
const spareKWh = batteryKWh*0.2

const consumptionConfig = {
  baseLoad: {
    load: 210,
    startTime: 0,
    duration: 24
  },
  pc: {
    load: 50,
    startTime: 0,
    duration: 24
  },
  pcScreen: {
    load: 50,
    startTime: 8,
    duration: 16,
  },
  tv: {
    load: 150,
    startTime: 0,
    duration: 24
  },
  gpuMiner: {
    load: 450
  },
  cpuMiner: {
    load: 50
  },
  breakfast:{
    load: 600,
    startTime: 6.5,
    duration: 2 
  },
  dinner: {
    load: 800,
    startTime: 17.5,
    duration: 2
  },
  lunch: {
    load: 800,
    startTime: 11.5,
    duration: 2
  }
}

async function updateFileDB(url, dbFilePath){
 
  let fileObj
  try{
    const forecastRes = await fetch(url)
    const forecastObj = await forecastRes.json()
    forecastObj.timestamp = new Date().getTime()

    fs.writeFileSync(dbFilePath, JSON.stringify(forecastObj))

    const fileContents = fs.readFileSync(dbFilePath).toString()
    fileObj = JSON.parse(fileContents)
  } catch(error){
    console.log({error})
  }
  return fileObj
}

async function forecastPVPowerProduction(fileObj){

  const timeArray = []
  const valueArray = []
  for(const forecast of fileObj.forecasts){
    timeArray.push(forecast.period_end)
    valueArray.push(forecast.pv_estimate/2)
  }

  return {
    timeArray,
    valueArray
  }
}

async function forecastPowerConsumption(forecastStart, forecastEnd){

  let time = forecastStart
  const timeArray = []
  const valueArray = []
  while(time <= forecastEnd){
    const timeCursor = time.getHours() + time.getMinutes()/60 //minutes out of 60, eg 30 minutes is 0.5
    let load = 0
    for(const key in consumptionConfig){
      const item = consumptionConfig[key]
      if(item.startTime < timeCursor && item.startTime + item.duration >= timeCursor){
        load += item.load/2
      }
    }
       
    valueArray.push(load/1000)
    timeArray.push(time) 
    
    time = new Date(time.getTime() + 30*60*1000) // step forward 30 minutes in time
  }
  
  return {
    timeArray,
    valueArray
  } 
}

function addForecasts(forecast1, forecast2){

  if(forecast1.timeArray.length != forecast2.timeArray.length){
    throw Error('Forecast lengths differ')
  }

  const valueArray = []
  for(let i in forecast1.valueArray){
    const value = forecast1.valueArray[i] + forecast2.valueArray[i]
    valueArray.push(value)
  }

  return {
    timeArray: forecast1.timeArray,
    valueArray
  }
}

async function forecastBatteryKWh(PVPowerForecast, powerConsumptionForecast){

  //TODO: get this from the influxDB & config
  const SOC = 0.77
  let remainingKWh = batteryKWh*SOC
  
  if(PVPowerForecast.timeArray.length != powerConsumptionForecast.timeArray.length){
    throw Error('Forecast lengths differ')
  }

  const valueArray = []
  for(let i in PVPowerForecast.timeArray){
    // We need to devide the PVPowerForecast and the powerConsumptionForecast to take in to account that their values are the average over the last 30 minutes
    // TODO: The available capacity is not aligned to the half hour averages presented by the PVPowerForecast and powerConsumptionForecast, this needs to be addressed to be accurate
    const PVPowerVsConsumption = PVPowerForecast.valueArray[i]/2 - powerConsumptionForecast.valueArray[i]/2
    console.log({PVPowerVsConsumption})

    if(remainingKWh + PVPowerVsConsumption >= batteryKWh){
      remainingKWh = batteryKWh // The battery can't charge beyond full
    } else if (remainingKWh + PVPowerVsConsumption <= spareKWh){
      remainingKWh = spareKWh // The battery is empty, it can't give any more power
    } else {
      remainingKWh += PVPowerVsConsumption
    }

    console.log({remainingKWh})
    console.log('time:', PVPowerForecast.timeArray[i])

    valueArray.push(remainingKWh)
  }

  return {
    valueArray,
    timeArray: PVPowerForecast.timeArray
  }
}

function generatePowerConsumptionForecast(key, forecastStart, forecastEnd){

  const item = consumptionConfig[key]

  let time = forecastStart
  const timeArray = []
  const valueArray = []
  while(time <= forecastEnd){
    const timeCursor = time.getHours() + time.getMinutes()/60 //minutes out of 60, eg 30 minutes is 0.5
    let load = 0

    if(!item.startTime){
      load = item.load/2
    } else if(item.startTime < timeCursor && item.startTime + item.duration >= timeCursor){
      load = item.load/2
    }
       
    valueArray.push(load/1000)
    timeArray.push(time) 
    
    time = new Date(time.getTime() + 30*60*1000) // step forward 30 minutes in time
  }
  
  return {
    timeArray,
    valueArray
  } 
}

async function findPowerConsumptionForKey(key, forecastStart, forecastEnd, totalPVPowerForecast, baselinePowerConsumptionForecast){
  
  let keyConsumptionForecast = generatePowerConsumptionForecast(key, forecastStart, forecastEnd)
  let combinedConsumptionForecast = addForecasts(baselinePowerConsumptionForecast, keyConsumptionForecast)
  let batteryKWhForecast = await forecastBatteryKWh(totalPVPowerForecast, combinedConsumptionForecast)

  let i = 0
  for(; i < batteryKWhForecast.valueArray.length; i++){
    const value = batteryKWhForecast.valueArray[i]
    if(value <= spareKWh){
      let remainingKWh = value
      let poweroffTime = batteryKWhForecast.timeArray[i]
      while(i >= 0 && remainingKWh <= spareKWh){
         
          
      }
    }
  }  

  return {
    timeArray: batteryKWhForecast.timeArray,
    valueArray: batteryKWhForecast.valueArray
  }
}

async function main(){

  const currentTimestamp = new Date().getTime()

  const northFileContents = fs.readFileSync(northDbFilePath).toString()
  const eastFileContents = fs.readFileSync(eastDbFilePath).toString()
  let northFileObj = JSON.parse(northFileContents)
  let eastFileObj = JSON.parse(eastFileContents)

  /*if(currentTimestamp >= northFileObj.timestamp + timeBetweenUpdates){
    console.log('Updating solcast forcast')
    northFileObj = await updateFileDB(northPVForecastURL.href, northDbFilePath)
    eastFileObj = await updateFileDB(eastPVForecastURL.href, eastDbFilePath)
  }*/

  const northPVPowerForecast = await forecastPVPowerProduction(northFileObj)
  const eastPVPowerForecast = await forecastPVPowerProduction(eastFileObj)
  const totalPVPowerForecast = addForecasts(northPVPowerForecast, eastPVPowerForecast)

  const forecastStart = new Date(northPVPowerForecast.timeArray[0])
  const forecastEnd = new Date(northPVPowerForecast.timeArray[northPVPowerForecast.timeArray.length-1])
  
  const powerConsumptionForecast = await forecastPowerConsumption(forecastStart, forecastEnd)

  const baseBatteryKWhForecast = await forecastBatteryKWh(totalPVPowerForecast, powerConsumptionForecast)

  const gpuMiningBatteryKWhForecast = await findPowerConsumptionForKey('gpuMiner', forecastStart, forecastEnd, totalPVPowerForecast, powerConsumptionForecast)

  const data = [
    {
      x: baseBatteryKWhForecast.timeArray, 
      y: baseBatteryKWhForecast.valueArray, 
      type: 'line',
      name: 'baseBatteryKWhForecast'
    }, {
      x: gpuMiningBatteryKWhForecast.timeArray, 
      y: gpuMiningBatteryKWhForecast.valueArray, 
      type: 'line',
      name: 'gpuMiningBatteryKWhForecast'
    }
  ];

  plot(data);
  
}

main()

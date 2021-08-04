const nodeplotlib = require('nodeplotlib')
const fetch = require('node-fetch')
const fs = require('fs')

const northDbFilePath = './fileDB/northPVForecast.json'
const eastDbFilePath = './fileDB/eastPVForecast.json'
const northPVResourceID = 'a0dd-e584-8bb2-e610'
const eastPVResourceID = '358d-0598-b48e-1560'
const solcastApiKey = 'xMAqCnaDhQmCW7BHDvoj0VGCBvKVuXZ8'

const northPVForecastURL = new URL(`https://api.solcast.com.au/rooftop_sites/${northPVResourceID}/forecasts?format=json&api_key=${solcastApiKey}`)
const eastPVForecastURL = new URL(`https://api.solcast.com.au/rooftop_sites/${eastPVResourceID}/forecasts?format=json&api_key=${solcastApiKey}`)

const timeBetweenUpdates = 60*60*1000 // one hour

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

async function main(){

  const currentTimestamp = new Date().getTime()

  const northFileContents = fs.readFileSync(northDbFilePath).toString()
//  const eastFileContents = fs.readFileSync(eastDbFilePath).toString()
  let northFileObj = JSON.parse(northFileContents)
  let eastFileObj = null//JSON.parse(eastFileContents)

 // if(currentTimestamp >= northFileObj.timestamp + timeBetweenUpdates){
    console.log('Updating solcast forcast')
    northFileObj = await updateFileDB(northPVForecastURL.href, northDbFilePath)
    eastFileObj = await updateFileDB(eastPVForecastURL.href, eastDbFilePath)
  //}

  let northSum = 0
  const northSumArray = []
  const northTimeArray = []
  for(const northForecast of northFileObj.forecasts){
    northSum += northForecast.pv_estimate/2 // it is the average over 30 mins
    northSumArray.push(northSum)
    northTimeArray.push(northForecast.period_end)
    console.log('-')
    console.log(new Date(northForecast.period_end).toLocaleString())
    console.log({northSum})
  }

  let eastSum = 0
  const eastSumArray = []
  const eastTimeArray = []
  for(const eastForecast of eastFileObj.forecasts){
    eastSum += eastForecast.pv_estimate/2 // it is the average over 30 mins
    eastSumArray.push(eastSum)
    eastTimeArray.push(eastForecast.period_end)
    console.log('-')
    console.log(new Date(eastForecast.period_end).toLocaleString())
    console.log({eastSum})
  }

  
/*
  const plot = nodeplotlib.plot
  const Plot = nodeplotlib.Plot

  const data = [{
    x: [1, 3, 4, 5], 
    y: [3, 12, 1, 4], 
    type: 'line'
  }];

  plot(data);*/
  
}

main()

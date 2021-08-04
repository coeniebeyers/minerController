const Influx = require('influx')
const { spawn } = require('child_process')

let gpuMiner;
let gpuMinerIsRunning = false
const maxTimeBetweenMinerOutput = 120*1000
const timeBetweenCheckingMinerOutput = 1*1000
const timeBetweenCheckingSolarPower = 30*1000

const influx = new Influx.InfluxDB({
  host: '192.168.88.22',
  port: 8086,
  database: 'home_assistant'
})

async function getLastChargeCurrent(){

  const result1 = await influx.query(`
    SELECT LAST("value") FROM "A"
    WHERE ("entity_id" = 'voltronic_battery_charge_current')
  `)

  const inverter1 = result1[0].last

  const result2 = await influx.query(`
    SELECT LAST("value") FROM "A"
    WHERE ("entity_id" = 'voltronic2_battery_charge_current')
  `)

  const inverter2 = result2[0].last

  return {
    inverter1,
    inverter2,
    total: inverter1 + inverter2
  }
}

async function getLastStateOfCharge(){

  // Only inverter 1 has the correct state of charge since only it is plugged in to the BMS of the pylontech
  const result1 = await influx.query(`
    SELECT LAST("value") FROM "%"
    WHERE ("entity_id" = 'voltronic_battery_capacity')
  `)

  const inverter1 = result1[0].last
  return inverter1
}

const pathToGPUMiner = '/home/coenie/Downloads/xmrig-6.8.1-linux-x64/xmrig-6.8.1_GPU/xmrig'
let outputTimestamp = new Date().getTime()

function startGPUMiner(){
  
  gpuMiner = spawn(pathToGPUMiner)

  gpuMiner.stdout.on('data', function(data){
    process.stdout.write(data.toString())
    outputTimestamp = new Date().getTime()
  }) 
  gpuMiner.stderr.on('data', function(data){
    console.log(data.toString())
  }) 
  gpuMiner.on('close', function(code){
    console.log('GPU miner closing with code:', code)
    gpuMinerIsRunning = false
    gpuMiner = null
  }) 

  return gpuMiner
}

async function checkSolarAndToggleMiner(gpuMinerIsRunning, gpuMiner){

    console.log('Checking solar power')
    const chargeCurrent = await getLastChargeCurrent()
    console.log({chargeCurrent})
    const stateOfCharge = await getLastStateOfCharge()
    console.log({stateOfCharge})
    console.log({gpuMinerIsRunning})

    if(gpuMinerIsRunning == false && (chargeCurrent.total >= 90 || stateOfCharge > 95)){
      console.log('=================== Solar power sufficient, starting miner =================')
      gpuMiner = startGPUMiner()
      outputTimestamp = new Date().getTime()
      gpuMinerIsRunning = true
    } else if(gpuMinerIsRunning == true && chargeCurrent.total < 90 && stateOfCharge <= 95) {
      console.log('=================== Solar power insufficient, stopping miner =================')
      gpuMiner.stdin.pause()
      gpuMiner.kill()
      gpuMinerIsRunning = false
    }

  return {
    gpuMinerIsRunning,
    gpuMiner
  }
}

async function main(){
  let result = await checkSolarAndToggleMiner(gpuMinerIsRunning, gpuMiner)
  gpuMinerIsRunning = result.gpuMinerIsRunning
  gpuMiner = result.gpuMiner
  // Check solar power at a regular interval
  setInterval(async function(){
    result = await checkSolarAndToggleMiner(gpuMinerIsRunning, gpuMiner)
    gpuMinerIsRunning = result.gpuMinerIsRunning
    gpuMiner = result.gpuMiner
  }, timeBetweenCheckingSolarPower)

  // Check output from mining process at a regular interval
  setInterval(async function(){
    if(gpuMinerIsRunning){
      const timeSinceLastOutput = new Date().getTime() - outputTimestamp
      if(timeSinceLastOutput > maxTimeBetweenMinerOutput){
        console.log('=================== No output from miner, restarting miner =================')
        gpuMiner.stdin.pause()
        gpuMiner.kill()
        gpuMinerIsRunning = false
      }
    }
  }, timeBetweenCheckingMinerOutput)
}

main()

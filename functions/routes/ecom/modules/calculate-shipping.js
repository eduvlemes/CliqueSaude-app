exports.post = ({ appSdk, admin }, req, res) => {  
  
  const { storeId } = req
  const { application } = req.body
  let { params } = req.body
  
  const response = {
    shipping_services: []
  }
  //console.log('-------'+ storeId +'-------')
  //console.log('------------')
  //console.log(JSON.stringify(params))
  //console.log('------------')
    // app configured options
    const config = Object.assign({}, application.data, application.hidden_data)
    
    let scheduleDate
    let scheduleList
    let minifyScheduleDate
    let currentDay
    let scheduleDateOrder

    let shippingRules
    
    
    if (Array.isArray(config.shipping_rules) && config.shipping_rules.length) {
      shippingRules = config.shipping_rules      
    } else {
      // anything to do without shipping rules
      //console.log('derp 2')
      res.send(response)
      return
    }

    const destinationZip = params.to ? params.to.zip.replace(/\D/g, '') : ''
    let originZip = params.from
      ? params.from.zip
      : config.zip ? config.zip : ''

    const checkZipCode = rule => {
      // validate rule zip range
      if (destinationZip && rule.zip_range) {
        const { min, max } = rule.zip_range
        return Boolean((!min || destinationZip >= min) && (!max || destinationZip <= max))
      }
      return true
    }

    // search for configured free shipping rule and origin zip by rule
    for (let i = 0; i < shippingRules.length; i++) {
      const rule = shippingRules[i]
      if (
        checkZipCode(rule) &&
        !rule.total_price &&
        !rule.disable_free_shipping_from &&
        !(rule.excedent_weight_cost > 0) &&
        !(rule.amount_tax > 0)
      ) {
        if (!originZip && rule.from && rule.from.zip) {
          originZip = rule.from.zip
        }
        if (!rule.min_amount) {
          response.free_shipping_from_value = 0
          if (originZip) {
            break
          }
        } else if (!(response.free_shipping_from_value <= rule.min_amount)) {
          response.free_shipping_from_value = rule.min_amount
        }
      }
    }

    // params object follows calculate shipping request schema:
    // https://apx-mods.e-com.plus/api/v1/calculate_shipping/schema.json?store_id=100
    if (!params.to) {
      // respond only with free shipping option
      //console.log('derp 3')
      res.send(response)
      return
    }

    if (!originZip) {
      // must have configured origin zip code to continue
      //console.log('dididi 1')
      return res.status(400).send({
        error: 'CALCULATE_ERR',
        message: 'Zip code is unset on app hidden data (merchant must configure the app)'
      })
    } else if (typeof originZip === 'string') {
      originZip = originZip.replace(/\D/g, '')
    }


    if(params.service_code){
      if(params.service_code.includes('|')){
        scheduleDate =  params.service_code.includes('ScheduleDate:') ? params.service_code.split('|')[1].replace('ScheduleDate:','') : null
        params.service_code = params.service_code.split('|')[0]
      }else{
        scheduleDate =  params.service_code.includes('ScheduleDate:') ? params.service_code.replace('ScheduleDate:','') : null
        delete params['service_code']
      }
      if(scheduleDate != null){
        scheduleDateOrder = scheduleDate
        scheduleDate = scheduleDate.includes(':') ? scheduleDate.split(' ')[0] : scheduleDate
      }
    }

    

    if(scheduleDate != null){
      let separator = scheduleDate.includes('-') ? '-' : '/'
      let currentDayFormat
      
      if(separator == "-"){
        currentDayFormat =  scheduleDate.split(separator)[1] + '/' + scheduleDate.split(separator)[2] + '/' + scheduleDate.split(separator)[0]
      }else{
        currentDayFormat =  scheduleDate.split(separator)[1] + '/' + scheduleDate.split(separator)[0] + '/' + scheduleDate.split(separator)[2]
      }      
      
      minifyScheduleDate = currentDayFormat.replace('/','').replace('/','')
      currentDayFormat = new Date(currentDayFormat)
      currentDay = currentDayFormat.getDay()
    }
      // admin.firestore().doc(`${storeId}/${minifyScheduleDate}`).get().then((docSnapshot) => {
      //   if(docSnapshot.exists){
      //     scheduleList = docSnapshot.get('schedules')
      //   }else{
      //     scheduleList = null
      //   }
      //======================================================================== COMEÇA AQUI
      let amount = params.subtotal || 0
      if (params.items) {
        let finalWeight = 0
        params.items.forEach(({ price, quantity, dimensions, weight }) => {
          let physicalWeight = 0
          let cubicWeight = 1
          if (!params.subtotal) {
            amount += price * quantity
          }

          // sum physical weight
          if (weight && weight.value) {
            switch (weight.unit) {
              case 'kg':
                physicalWeight = weight.value
                break
              case 'g':
                physicalWeight = weight.value / 1000
                break
              case 'mg':
                physicalWeight = weight.value / 1000000
            }
          }

          // sum total items dimensions to calculate cubic weight
          if (dimensions) {
            const sumDimensions = {}
            for (const side in dimensions) {
              const dimension = dimensions[side]
              if (dimension && dimension.value) {
                let dimensionValue
                switch (dimension.unit) {
                  case 'cm':
                    dimensionValue = dimension.value
                    break
                  case 'm':
                    dimensionValue = dimension.value * 100
                    break
                  case 'mm':
                    dimensionValue = dimension.value / 10
                }
                // add/sum current side to final dimensions object
                if (dimensionValue) {
                  sumDimensions[side] = sumDimensions[side]
                    ? sumDimensions[side] + dimensionValue
                    : dimensionValue
                }
              }
            }

            // calculate cubic weight
            // https://suporte.boxloja.pro/article/82-correios-calculo-frete
            // (C x L x A) / 6.000
            for (const side in sumDimensions) {
              if (sumDimensions[side]) {
                cubicWeight *= sumDimensions[side]
              }
            }
            if (cubicWeight > 1) {
              cubicWeight /= 6000
            }
          }
          finalWeight += (quantity * (physicalWeight > cubicWeight ? physicalWeight : cubicWeight))
        })

        

        const validShippingRules = shippingRules.filter(rule => {
          if (typeof rule === 'object' && rule) {
            return (!params.service_code || params.service_code === rule.service_code) &&
              checkZipCode(rule) &&
              (!rule.min_amount || amount >= rule.min_amount) &&
              (!rule.max_cubic_weight || rule.excedent_weight_cost > 0 || finalWeight <= rule.max_cubic_weight)
          }
          return false
        })

        
        
      
        if (validShippingRules.length) {
          // group by service code selecting lower price
          const shippingRulesByCode = validShippingRules.reduce((shippingRulesByCode, rule) => {
            if (typeof rule.total_price !== 'number') {
              rule.total_price = 0
            }
            if (typeof rule.price !== 'number') {
              rule.price = rule.total_price
            }
            if (rule.excedent_weight_cost > 0 && finalWeight > rule.max_cubic_weight) {
              rule.total_price += (rule.excedent_weight_cost * (finalWeight - rule.max_cubic_weight))
            }
            if (typeof rule.amount_tax === 'number' && !isNaN(rule.amount_tax)) {
              rule.total_price += (rule.amount_tax * amount / 100)
            }
            const serviceCode = rule.service_code
            const currentShippingRule = shippingRulesByCode[serviceCode]
            if (!currentShippingRule || currentShippingRule.total_price > rule.total_price) {
              shippingRulesByCode[serviceCode] = rule
            }
            return shippingRulesByCode
          }, {})

          // parse final shipping rules object to shipping services array
          for (const serviceCode in shippingRulesByCode) {
            const rule = shippingRulesByCode[serviceCode]
            
            if (rule) {
              let { label, scheduledDeliveryConfig } = rule

              // delete filter properties from rule object
              delete rule.service_code
              delete rule.zip_range
              delete rule.min_amount
              delete rule.max_cubic_weight
              delete rule.excedent_weight_cost
              delete rule.amount_tax
              delete rule.label

              // also try to find corresponding service object from config
              let service
              if (Array.isArray(config.services)) {
                service = config.services.find(service => service.service_code === serviceCode)
                if (!label) {
                  label = service.label
                }
              }
              if (!label) {
                label = serviceCode
              }                
              let ship_rule = {
                // label, service_code, carrier (and maybe more) from service object
                ...service,
                service_code: serviceCode,
                label,
                shipping_line: {
                  from: {
                    ...rule.from,
                    ...params.from,
                    zip: originZip
                  },
                  to: params.to,
                  price: 0,
                  total_price: 0,
                  // price, total_price (and maybe more) from rule object
                  ...rule,
                  delivery_time: {
                    days: 20,
                    working_days: true,
                    ...rule.delivery_time
                  },
                  delivery_rules:{
                    ...rule.delivery_rules
                  },
                  posting_deadline: {
                    days: 0,
                    ...config.posting_deadline,
                    ...rule.posting_deadline
                  }                
                }
              }
              
              if(scheduleDate != null && typeof scheduledDeliveryConfig != "undefined"){
                let oObj_custom_fields = []
                for (let i = 0; i < scheduledDeliveryConfig.length; i++) {
                  day_config = JSON.parse(scheduledDeliveryConfig[i])
                  oObj_custom_fields.push({field: i, value:JSON.stringify(day_config)})
                }
                ship_rule.shipping_line.custom_fields = oObj_custom_fields
              }

              
              
              if(params.is_checkout_confirmation){
                //console.log('certo')
                //console.log(JSON.stringify(ship_rule))
                if(scheduleDate != null){
                  //console.log('não era pra ta aqui')
                  ship_rule.service_code= ship_rule.service_code + '|ScheduleDate:' + scheduleDateOrder,
                  ship_rule.shipping_line.scheduled_delivery = {
                    end : new Date(scheduleDateOrder).toISOString()
                  }
                  let order_scheduleTime = scheduleDateOrder.split(' ')[1]
                  let order_name = params.to.name
                  let order_serviceCode = params.service_code
                  const scheduleConfirm = admin.firestore().doc(`${storeId}/${minifyScheduleDate}`)
                  scheduleConfirm.get().then((docSnapshot) => {
                    if(docSnapshot.exists){        
                      //console.log('iha 1')          
                      const reg = docSnapshot.get('schedules')
                      //console.log(JSON.stringify(reg))
                      if(typeof reg == "undefined"){
                        //console.log('save a')
                        scheduleConfirm.set({
                          schedules: [{time: order_scheduleTime, name: order_name, service_code: order_serviceCode}]
                        }).then(function(){
                          //console.log('save b')          
                          response.shipping_services.push(ship_rule)
                          //console.log('derp 4')
                          res.send(response)
                        })
                        
                      }else{
                        //console.log('iha 2')         
                        let updateSchedules = reg
                        let query = updateSchedules.filter(el => el.time == order_scheduleTime && el.service_code == order_serviceCode)
                        if(query.length == 0){
                          //console.log('save c')
                          updateSchedules.push({time: order_scheduleTime, name: order_name, service_code: order_serviceCode})
                          scheduleConfirm.set({
                            schedules:updateSchedules
                          }).then(function(){
                            //console.log('save d')
                            response.shipping_services.push(ship_rule)
                            //console.log('derp 5')
                            res.send(response)
                          })                      
                        }else{
                          //console.log('dididi 2')
                          res.status(400).send({
                            error: 'CALCULATE_ERR',
                            message: 'Dia e horário já agendados'
                          })
                        }
                      }
                    }else{
                      //console.log('iha 3')     
                      scheduleConfirm.set({
                        schedules: [{time: order_scheduleTime, name: order_name, service_code: order_serviceCode}]
                      }).then(function(){
                        //console.log('save e')
                        response.shipping_services.push(ship_rule)
                        //console.log('derp 6')
                        res.send(response)
                      })                      
                    }
                  })        
                  .catch(err => {
                    //console.log('save d')
                    //console.log(err)
                  })   
                }else{
                  //console.log('pega regra')
                  response.shipping_services.push(ship_rule)
                }        
              }else{
                if(scheduleDate != null && typeof scheduledDeliveryConfig != "undefined"){
                  response.shipping_services.push(ship_rule)
                }   
                if(scheduleDate == null && typeof scheduledDeliveryConfig == "undefined"){
                  response.shipping_services.push(ship_rule)
                }              
              }            
            }
          }
          if(params.is_checkout_confirmation && scheduleDate == null)  {
            //console.log('ta aqui agora')
            //response.shipping_services.push(ship_rule)
            res.send(response)
          } 
        }
      }
      if(!params.is_checkout_confirmation)  {
        //console.log('derp 1')
        res.send(response)
      }  
      //======================================================================== TERMINA AQUI
      // })        
      // .catch(err => {
      //   //console.log(err)
      // })      
    // }else{
      
    // }
}

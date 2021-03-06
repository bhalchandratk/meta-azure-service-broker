/* jshint camelcase: false */
/* jshint newcap: false */

var _ = require('underscore');
var HttpStatus = require('http-status-codes');
var async = require('async');
var Config = require('./service');
var common = require('../../common');
var log = common.getLogger(Config.name);

var cosmosDbPoll = function(params) {
  
  var provisioningResult = params.provisioning_result || {};
  var lastoperation = params.last_operation || '';

  var resourceGroupName = provisioningResult.resourceGroupName || '';
  var cosmosDbAccountName = provisioningResult.cosmosDbAccountName || '';
  
  var reqParams = params.parameters || {};
  var cosmosDbName = reqParams.cosmosDbName || '';

  function sendReply(reply, callback){
    reply = {
      statusCode: HttpStatus.OK,
      code: HttpStatus.getStatusText(HttpStatus.OK),
      value: reply,
    };
    callback(null, reply, provisioningResult);
  }
  
  this.poll = function(cosmosDb, callback) {
    var reply = {
      state: '',
      description: '',
    };
    
    cosmosDb.getCosmosDbAccount(resourceGroupName, cosmosDbAccountName, function(err, res, body) {
      
      if (err) {
        return callback(err);
      }
        
      if (lastoperation === 'provision') {
        if (res.statusCode != HttpStatus.OK) {
          var e = new Error(body);
          e.statusCode = res.statusCode;
          return callback(e);
        }
        
        var account = JSON.parse(body);
        
        var accountState = account.properties.provisioningState;
        log.info('Getting the provisioning state of the cosmosDb account %s: %j', cosmosDbAccountName, accountState);
      
        if (accountState == 'Succeeded') {
          var hostEndpoint = account.properties.documentEndpoint;
          
          if (reqParams.kind === 'MongoDB') {
            reply.state = 'succeeded';
            reply.description = 'Created the cosmosDb';
            _.extend(provisioningResult, {hostEndpoint: hostEndpoint});
            sendReply(reply, callback);
          } else {
            async.waterfall([
              function(callback) {
                cosmosDb.getAccountKey(resourceGroupName, cosmosDbAccountName, function(err, masterKey) {
                  callback(err, masterKey);
                });
              },
              function(masterKey, callback) {
                cosmosDb.createDocDbDatabase(hostEndpoint, masterKey, cosmosDbName, function(err, database) {
                  /*
                    See the sample of "database" here: https://msdn.microsoft.com/en-us/library/azure/mt489072.aspx
                    The broker uses following properties in "database":                
                    {
                      "id": "volcanodb2", // The same to database name
                      "_self": "dbs\/CqNBAA==\/" // Database link, which used for creating collections, documents...
                    }
                  */
                  callback(err, database);
                });
              }
            ], function(err, database) {
              if (err) {
                callback(err);
              } else {
                reply.state = 'succeeded';
                reply.description = 'Created the cosmosDb';
                _.extend(provisioningResult, {hostEndpoint: hostEndpoint, database: database});
                sendReply(reply, callback);
              }
            });
          }
        } else {
          reply.state = 'in progress';
          reply.description = 'Creating the cosmosDb account, state: ' + accountState;
          sendReply(reply, callback);
        }
      
      } else {
        if (res.statusCode == HttpStatus.NOT_FOUND) {
          reply.state = 'succeeded';
          reply.description = 'Deleted the cosmosDb account';
        } else if (res.statusCode == HttpStatus.OK) {
          var accountState = JSON.parse(body).properties.provisioningState;
          log.info('Getting the deprovisioning state of the cosmosDb account %s: %j', cosmosDbAccountName, accountState);
          
          reply.state = 'in progress';
          reply.description = 'Deleting the cosmosDb account, state: ' + accountState;
        } else {
          var e = new Error(body);
          e.statusCode = res.statusCode;
          return callback(e);
        }
        sendReply(reply, callback);
      }
    });
  };
};

module.exports = cosmosDbPoll;


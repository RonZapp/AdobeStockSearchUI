"use strict";

var https = require('https');
var http = require('http');
var cheerio = require('cheerio');
var store = require('store');

// Workaround for storing page info.
var jsonResponse = null;
const adobeMode = true;
const imagesPerPage = adobeMode ? 64 : 100;
const numRequest = 8;
var tagFrequencies = {};
const searchWords = 'search_parameters[words]';
const searchLimit = `search_parameters[limit]`;
const searchOffset = `search_parameters[offset]`;
const searchSimilarUrl = `search_parameters[similar_url]`;
var resultCount;

/**
 * Parses the search query and write the images to the HTML page.
 * 
 * @param {CheerioStatic} $
 * @param {any} fullQuery 
 * @param {http.ServerResponse} response 
 */
function parseSearchQuery($, fullQuery, response) {
        var thumbnailList = [];
    for (let i = 1; i <= numRequest; i++) {
       asyncThumbnailRequest($,response, fullQuery,i).then(
            function(value){
                if(!value) {
                    throw new Error("We couldn't get a correct object");
                }
                return asyncIdRequest($, response, fullQuery, value, i).then(
                    function(requestResult) {
                        thumbnailList.push(requestResult.tags);
                        if (thumbnailList.length == numRequest) {
                            var results;
                            let theTags = store.get('tags');
                            let displayTags = {};
                            if (theTags === undefined || theTags === null) {
                                //sort the tags in decreasing order
                                results = sortKeysDecreasing(tagFrequencies);
                                results.forEach(function(element, index, array){ displayTags[element] = tagFrequencies[element] });
                                store.set('tags', displayTags);
                            } else {
                                //calculate delta
                                let delta = calcDelta(theTags, tagFrequencies);
                                results = sortKeysDecreasing(delta);
                                results.forEach(function(element, index, array){ displayTags[element] = delta[element] });
                                store.set('tags', displayTags);
                            }

                            //place tags on the top of the page.
                            var tagATag = createTagHTML(results, fullQuery);
                            $('#displaytags').append(tagATag);
                            thumbnailList.forEach(function(element){
                                var thumbnailsHtml = $('#imageDiv').append(element);
                                var thumbnails = thumbnailsHtml.children('img');
                                thumbnails.addClass('resultImage');
                                thumbnails.attr('onclick', `
                                    document.getElementById('urlQuery').value = this.getAttribute('src');
                                    document.getElementById('mainForm').submit();
                                `);
                            
                            });

                            //TODO Get the correct page count.

                            // Check for valid page number inputs.
                           
                            let pageCount = Math.max(Math.ceil(resultCount / (imagesPerPage*numRequest), 1));

                            // Write the page number into the input box.
                            var pageNumberBox = $('#pageNumber');
                            pageNumberBox.val(fullQuery.pageNumber);
                            pageNumberBox.attr('size', Math.floor(Math.log10(pageCount)) + 1);
                            pageNumberBox.attr('maxlength', Math.floor(Math.log10(pageCount)) + 2);

                            // Write out the max page number
                            $('#maxPageNumber').text(`${pageCount}`);
                            console.log("Ending prior to use");
                            response.writeHead(200, {'Content-Type': 'text/html' });
                            response.write($.html());
                            response.end();
                        }
                    }
                );
        });

    }
    //batchRequests($, response, fullQuery)

}




function asyncIdRequest(cheerio$, response, fullQuery, obj, counter){
    return new Promise(function(resolve, reject) {
        var idOptions = {
                        hostname: "www.andyedmonds.com",
                        path: "/wp-content/stock/search_id.php?ids=" + obj[`ids`],
                        method: "GET"
                    };

                http.get(idOptions,function(idResponse){
                    var info = "";
                    idResponse.on("data", function(data){
                        info += data;
                    });
                    idResponse.on("end", function(){
                        let tags = JSON.parse(info);
                        let keys = Object.keys(tags);
                        keys.forEach(function(element, index, array){             
                            tags[element]["keywords"].forEach(function(element, index, array) {
                                if (tagFrequencies[element.name] == undefined) {
                                    tagFrequencies[element.name] = 1;
                                }  else {
                                    tagFrequencies[element.name] += 1;
                                }
                            });
                        });
                    let resultTags = {
                        tags: obj[`tags`],
                        counter: counter
                    };
                    resolve(resultTags);
                    });
                    idResponse.on("error",(e)=> {
                        console.log(`Got Error ${e.message}`);
                        reject();
                    });
                });
    });
}


function asyncThumbnailRequest(cheerio$, response, query, offset){
    return new Promise(
        function(resolve, reject){
            var host = "stock.adobe.io";
            var fullPath = "/Rest/Media/1/Search/Files?";
                // get the key of limit
                var parameters = "";
                parameters += searchWords + '=' + query.tagQuery + '&';
                parameters += searchLimit + '=' + imagesPerPage + '&';
                parameters += searchOffset + '=' + (offset * imagesPerPage) + '&';
                parameters += searchSimilarUrl + '=' + query.urlQuery;
                var options = {
                    hostname: host,
                    path: fullPath+parameters,
                    method: "GET",
                    headers: {
                        'X-Product': 'Photoshop/15.2.0',
                        'x-api-key': '196dd2bfb89244c694211114553dae9e'
                    }
                };
           https.get(options, function(mrEdmondResponse){
                var body = "";
                mrEdmondResponse.on('data',function(data){
                    body += data;
                });
                mrEdmondResponse.on('end', function(){
                    resultCount = getNumberOfResults(body);
                    resolve(getThumbnails(body));
                });
                mrEdmondResponse.on('error', function(error){
                    reject(error);
                });
           });
        });
}


/**
 * Sends a request to Mr. Edmonds' website, which should send back a JSON
 * formatted document. Then, write all the thumbnails to the response to the
 * client.
 * 
 * @param {CheerioStatic} $ 
 * @param {http.ServerResponse} mrEdmondResponse 
 * @param {http.ServerResponse} clientResponse 
 */
function sendRequestToMrEdmond($, fullQuery, mrEdmondResponse, clientResponse) {
    var body = "";
    mrEdmondResponse.on("data", function (data) {
        body += data;
    });
    
    mrEdmondResponse.on("end", function () {
        // Write images
        jsonResponse = body;
        let obj = getThumbnails(body);
        let thumbnailList = obj["tags"];
        let tagInfo = obj["ids"];
        
        var options = {
            hostname: "www.andyedmonds.com",
            path: "/wp-content/stock/search_id.php?ids=" + tagInfo,
            method: "GET"
        };
        // Fetch tags from API
        http.get(options, function(response) {
            var info = ""
            response.on("data", function(data){
                info += data;
            });
            response.on("end", function(){
                let tags = JSON.parse(info);
                let keys = Object.keys(tags);

                keys.forEach(function(element, index, array){             
                    tags[element]["keywords"].forEach(function(element, index, array) {
                        if (tagFrequencies[element.name] == undefined) {
                            tagFrequencies[element.name] = 1;
                        } else {
                            tagFrequencies[element.name] += 1;
                        }
                    });
                });

                /* Check local storage for tags*/
                var results;
                let theTags = store.get('tags');
                let displayTags = {};
                if (theTags === undefined || theTags === null) {
                    //sort the tags in decreasing order
                    results = sortKeysDecreasing(tagFrequencies);
                    results.forEach(function(element, index, array){ displayTags[element] = tagFrequencies[element] });
                    store.set('tags', displayTags);
                } else {
                    //calculate delta
                    let delta = calcDelta(theTags, tagFrequencies);
                    results = sortKeysDecreasing(delta);
                    results.forEach(function(element, index, array){ displayTags[element] = delta[element] });
                    store.set('tags', displayTags);
                }

                //place tags on the top of the page.
                var tagATag = createTagHTML(results, fullQuery);
                $('#displaytags').append(tagATag);
                var thumbnailsHtml = $('#imageDiv').append(thumbnailList);
                var thumbnails = thumbnailsHtml.children('img');
                
                thumbnails.addClass('resultImage');
                thumbnails.attr('onclick', `
                document.getElementById('truePageNumber').value = 1;
                document.getElementById('urlQuery').value = this.getAttribute('src');
                document.getElementById('mainForm').submit();
                `);

                // Check for valid page number inputs.
                let resultsCount = getNumberOfResults(body);
                let pageCount = Math.max(Math.ceil(resultsCount / imagesPerPage), 1);

                // Write the page number into the input box.
                var pageNumberBox = $('#pageNumber');
                pageNumberBox.val(fullQuery.pageNumber);
                pageNumberBox.attr('size', Math.floor(Math.log10(pageCount)) + 1);
                pageNumberBox.attr('maxlength', Math.floor(Math.log10(pageCount)) + 2);

                // Write out the max page number
                $('#maxPageNumber').text(`${pageCount}`);
                console.log("Ending prior to use");
                clientResponse.writeHead(200, {'Content-Type': 'text/html' });
                clientResponse.write($.html());
                clientResponse.end();
            });

            response.on("error",(e)=> {
                console.log(`Got Error ${e.message}`);
            });
        });
    });
}

/**
 * @param [object Array] results the array of keys from decreasing order
 * @param {object} fullQuery the information with the query by client
 */
function createTagHTML(results, fullQuery) {
    return results.slice(0,10).map(function(element,index, array){
        var words = decodeURIComponent(fullQuery['tagQuery']);
        let newTag = ``;
        if (!isAQuery(words, element)) {
            newTag += `<span class="_resulttag">
                        <a class="_onClk" href="#" onclick="
                            document.getElementById('truePageNumber').value = 1;
                            document.getElementById('query').value+=' `+ element +`';
                            document.getElementById('mainForm').submit();">
                            <span class="sp">${element}</span>
                        </a>
                        </span>`;
        }
        return newTag;
    });
}

/**
 * checks to see if the value matches any of the queries
 * @param {object} words 
 * @param {object} value 
 */
function isAQuery(words, value) {
    let splitWords = words.split(" ");
    if (words === value) {
        return true;
    }
    for (var i = 0; i < splitWords.length; i++) {
        if (value === splitWords[i]) {
            return true;
        }
    }
    return false;
}

/**
 * @returns [object Array] the sorted keys from largest to smallest
 * 
 */
function sortKeysDecreasing(obj) {
    return Object.keys(obj).sort(function(a,b){ return obj[b] - obj[a] });
}

/**
 * @returns {Object} the delta object containing the results.   
 */

function calcDelta(oldResults, newResults) {
    var delta = {};
    for (var key in newResults) {
        var obj = oldResults[key];
        var obj2 = newResults[key];
        if (!oldResults.hasOwnProperty(key) && newResults.hasOwnProperty(key)) {
            delta[key] = obj2;
        } else if (oldResults.hasOwnProperty(key) && newResults.hasOwnProperty(key)) {
            delta[key] = obj2 / obj;
        }
    }
    return delta;
}

/**
 * Returns an array of thumbnails.
 * 
 * @param {http.ServerResponse} response 
 * @returns
 */
function getThumbnails(response) {
    let responseObj = JSON.parse(response);

    if (adobeMode) {
        responseObj = responseObj['files'];
    }
    let keys = Object.keys(responseObj);
    let imageList = new Array();
    let idList = new Array();
    for (let key of keys) {
        var htmlTag = responseObj[key]['thumbnail_html_tag'];
        var id = responseObj[key]['id'];
        if (typeof htmlTag !== "undefined") {
            imageList.push(htmlTag);
        }
        if (typeof id !== "undefined") {
            idList.push(id);
        }
    }
    var ids = idList.join(",");
    var obj = {
        ids:ids,
        tags:imageList
    };
    return obj;
}
/**
 * Returns the number of results on a page.
 * 
 * @param {ServerResponse} response
 * @returns 
 */
function getNumberOfResults(response) {
    let responseObj = JSON.parse(response);
    let imageList = new Array();
    var resultCount = responseObj['nb_results'];
    if (typeof resultCount !== "undefined") {
        return Number(resultCount);
    }
    return 0;
}

/** 
 * main logic of app
 * 
 */
var fs = require('fs');
var url = require('url');
var querystring = require('querystring');
function display_image() {
    http.createServer(function (request, response) {
        if (request.method === "GET" && request.headers['accept'].includes('text/html')) {
                let body = "";
                request.on('data', function (data) {
                    body += data.toString();
                });
                request.on('end', function () {
                    let separatedUrl = url.parse(request.url);
                    let path = separatedUrl.pathname;
                    let rawQueries = separatedUrl.query;

                    // Obtain the query information.
                    let formData = querystring.parse(rawQueries);
                    let encodedQuery = encodeURIComponent(formData['q'].replace(" img",""));
                    let encodedPageNumber = encodeURIComponent(formData['PageNumber']);
                    let encodedUrl = encodeURIComponent(formData['URLQuery']);

                    if (encodedPageNumber === undefined) {
                        encodedPageNumber = Math.max(encodedPageNumber, 1);
                    } else if (!Number.isInteger(Number(encodedPageNumber))) {
                        encodedPageNumber = 1;
                    }

                    // Read the HTML file and select key positions in the file.
                    let webHtmlPage = fs.readFileSync("index.html").toString();
                    var $ = cheerio.load(webHtmlPage);

                    // If raw queries is bad, then write as if it were the 8080 port.
                    if (!rawQueries) {
                        $('#pageNumberArea').remove();
                        response.write($.html());
                        response.end();
                        return;
                    }

                    // Add the orginal query back to the box.
                    if (formData['q']) {
                        $('#query').val(formData['q']);
                    }

                    if (encodedUrl) {
                        $('#urlQuery').val(formData['URLQuery']);
                    }
                    var fullQuery = {
                        tagQuery: (typeof encodedQuery !== "undefined") ? encodedQuery : "",
                        urlQuery: (typeof encodedUrl !== "undefined") ? encodedUrl : "",
                        pageNumber: encodedPageNumber
                    };

                    parseSearchQuery($, fullQuery, response);
                });
        }else {
                fs.readFile("index.html", function (err, data) {
                    if (err) {
                        console.log(err);
                        console.log("We entered here because there was extra and we couldn't open file");
                        response.writeHead(404, { 'Content-Type': 'text/html' });
                        response.end();
                    } else {
                        response.writeHead(200, { 'Content-Type': 'text/html' });
                        response.write(data.toString());
                        response.end();
                    }
                });
            }
    }).listen(8888);
}
module.exports = display_image;
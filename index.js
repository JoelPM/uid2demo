/**
 * This module defines a Cloud Function that serves the UID2 demo page as well as an endpoint that can return UID2
 * tokens to a web-app.
 *
 * Design:
 * The UID2 operator should be called by a pub with authenticated PII and the pub's UID2 bearer token. To prevent
 * the pub's bearer token from being exposed to the world this call should happen server side rather than from the
 * user's device/browser. For example, one can imagine this operation happening in the pub's CMS when a page is loaded.
 *
 * To simulate this appropriately, the demo does the UID2 operator call server-side when the demo page is loaded.
 * To separate concerns, the demo page itself is effectively a static template hosted at another location that
 * this CloudFunction fetches (and caches) and does variable substitution on.
 *
 * It is also possible to conceive of a world where the UID2 token fetch happens from a web-app. To support this
 * use case this CloudFunction can also be called with a 'Content-Type' of 'application/json' and a query string
 * argument of 'email_address' and will return the UID2 tokens as JSON.
 *
 * Required ENV variables:
 *   TMPL_HOST: Hostname where the UID2 test page template can be found. Eg: "dev.prebid.org"
 *   TMPL_PATH: Path to the template page. Eg: "/foo/bar/uid2demo.html"
 *   UID2_HOST: Hostname of the UID2 operator. Eg: "uid2-dev.prebid.org"
 *   UID2_PATH:   Path for UID2 operator. Eg: "/v1/token/generate?email="
 *   UID2_BEARER: Token used to interact with the UID2 Operator. Eg: "ZbymabVViNwxiMu3RX/8cGQ48d2JqnxXQFeBXW3MAm2="
 *
 * Deployment:
 * This function can be deployed using the gcloud commandline. The following arguments are needed:
 *   --entry-point index
 *   --runtime nodejs14
 *   --trigger-http
 *   --allow-unauthenticated
 *   --set-env-vars (for all the variables listed above)
 *
 * gcloud functions deploy uid2-demo \
 *   --entry-point index \
 *   --runtime nodejs14 \
 *   --trigger-http \
 *   --allow-unauthenticated \
 *   --set-env-vars TMPL_HOST="dev.prebid.org" \
 *   --set-env-vars TMPL_PATH="/identity/uid2demo.html" \
 *   --set-env-vars UID2_HOST="uid2-dev.prebid.org" \
 *   --set-env-vars UID2_PATH="/v1/token/generate?email=" \
 *   --set-env-vars UID2_BEARER="ZbymabVViNwxiMu3RX/8cGQ48d2JqnxXQFeBXW3MAm2="
 *
 * @type {module:https}
 */

const https = require('https');
const moment = require('moment');

// Make logging a little easier
const logObj = (op, status, obj = {}) => {
    obj.op = op;
    obj.status = status;
    console.log(JSON.stringify(obj));
};

// Log the environment vars
logObj('startup', 'env loaded', {'env': process.env});

/**
 * Request params to sue for fetching the page template.
 */
const getPageTemplateParams = () => {
    return {
        hostname: process.env.TMPL_HOST,
        port: process.env.TMPL_PORT || 443,
        path: process.env.TMPL_PATH,
        method: 'GET',
    }
};

/**
 * Simple cache object for the template page.
 * @type {{template: string, loadTime: null}}
 */
const templateCache = {
    template: '',
    loadTime: null
}

/**
 * Return the parameters to make a UID2 token request for a given email address.
 * @param email - email address to use for generating the token
 * @returns RequestOptions
 */
const getTokenReqParams = (email) => {
    return {
        hostname: process.env.UID2_HOST,
        port: process.env.UID2_PORT || 443,
        path: process.env.UID2_PATH + email,
        method: 'GET',
        headers: {
            'Authorization': 'Bearer ' + process.env.UID2_BEARER,
        }
    }
};

/**
 * Fetches the demo page template from the configured location.
 * @returns {Promise<unknown>}
 */
const loadTemplate = () => {
    return new Promise(function (resolve, reject) {
        https.request(getPageTemplateParams(), (res) => {
            let template = '';
            res.on('data', (data) => {
                template += data
            });
            res.on('end', () => {
                templateCache.template = template;
                templateCache.loadTime = moment();
                logObj('loadTemplate', 'success');
                resolve(templateCache.template);
            });
            logObj('loadTemplate', 'started');
        }).on('error', (e) => {
            logObj('loadTemplate', 'error', {'error': e});
            reject(e);
        }).end();
    });
};

/**
 * Returns the page template, reloading it if more than a minute has elapsed from the last load time.
 */
const getTemplate = async () => {
    if (templateCache.template === '' || moment().diff(templateCache.loadTime, 'seconds') < 60) {
        logObj('getTemplate', 'reloading template');
        return await loadTemplate();
    } else {
        logObj('getTemplate', 'using cached');
        return templateCache.template;
    }
};

/**
 * Fetch the UID2 token for the given email address.
 * @param email
 * @returns {Promise<void>}
 */
const getToken = (email) => {
    return new Promise(function(resolve, reject) {
	    https.request(getTokenReqParams(email), (tokenRes) => {
	        let tokenResponse = '';
	        tokenRes.on('data', (data) => {
	            tokenResponse += data
	        });
	        tokenRes.on('end', () => {
	            let token = JSON.parse(tokenResponse);
	            logObj('getToken', 'success', {'token': token});
	            resolve(token);
	        });
	        logObj('getToken','started');
	    }).on('error', (e) => {
	        logObj('getToken', 'error', {'error': e});
	        reject(e);
	    }).end();
    }
)};

/**
 * HTTP Cloud Function.
 * This function is exported by index.js, and is executed when
 * you make an HTTP request to the deployed function's endpoint.
 *
 * @param {Object} req Cloud Function request context.
 *                     More info: https://expressjs.com/en/api.html#req
 * @param {Object} res Cloud Function response context.
 *                     More info: https://expressjs.com/en/api.html#res
 */
exports.index = (req, res) => {
    let email = 'me@example.com';
    if (req.body && req.body['email_address']) {
        email = req.body.email_address;
    } else if (req.query && req.query['email_address']) {
        email = req.query.email_address;
    }
    logObj('index', 'email', {'email': email});

    getToken(email).then((token) => {
        if ('application/json' === req.get('content-type')) {
            sendToken(res, email, token);
        } else {
            sendDemoPage(res, email, token["body"]["advertising_token"]);
        }
    });
};

/**
 * Write the token response back to the stream.
 * @param res The response object.
 * @param email The email address that this token corresponds to.
 * @param tokenObj The token response from the UID2 operator.
 */
const sendToken = (res, email, tokenObj) => {
    res.status(200);
    res.set('content-type', 'application/json');
    res.send(JSON.stringify(tokenObj));
};

/**
 * Write the demo page back to the stream, doing the appropriate substitutions.
 * @param res The response object.
 * @param email The email address that this token corresponds to.
 * @param advToken The advertising token from the UID2 Operator response.
 */
const sendDemoPage = (res, email, advToken) => {
    getTemplate().then((template) => {
        template.split('\n').filter((line) => {
            if (line.indexOf('let EMAIL') > 0) {
                res.write(line.replace('null', '"' + email + '"'));
            } else if (line.indexOf('let UID2TOKEN') > 0) {
                res.write(line.replace('null', '"' + advToken + '"'));
            } else if (line.indexOf('UID2_TOKEN') > 0) {
                res.write(line.replace('UID2_TOKEN', advToken));
            } else {
                res.write(line);
            }
            res.write('\n');
        });

        res.status(200).end();
    }).catch((e) => {
        res.write(JSON.stringify(e));
        res.status(400).end();
    });
};

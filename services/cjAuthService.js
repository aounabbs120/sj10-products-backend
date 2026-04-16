const axios = require('axios');

exports.getUpdateToken = async () => {
    try {
        const response = await axios.post('https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken', {
            apiKey: process.env.CJ_API_KEY
        });
        // CJ API usually returns success in 'result' field
        if (response.data.result || response.data.code === 200) {
            return response.data.data.accessToken;
        }
        console.log("CJ Token Response Error:", response.data.message);
        return null;
    } catch (error) {
        console.error("Axios Auth Error:", error.message);
        return null;
    }
};
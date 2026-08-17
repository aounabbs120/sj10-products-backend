// runScraper.js (Root folder mein)
require('dotenv').config(); // Agar env file use ho rahi hai
const scraperController = require('./controllers/autoCategoryScraper'); // Path check kar lijiyega

// Execute the function
console.log("Starting Background Scraper...");

scraperController.runAutoScraper(null, null)
    .then(() => {
        console.log("🏁 All Done! Process Exiting...");
        process.exit(0); // Kaam khatam hone ke baad script rok de
    })
    .catch((err) => {
        console.error("❌ Error:", err);
        process.exit(1);
    });
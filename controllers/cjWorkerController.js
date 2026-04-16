const axios = require('axios');
const { clients } = require('../config/tursoConnection');
// 🔥 YE LINE ADD KARNI HAI (Function ko import karne ke liye)
const { getUpdateToken } = require('../services/cjAuthService');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

exports.runAutoUpdate = async (req, res) => {
    const { shards, secret } = req.query;

    if (secret !== process.env.CRON_SECRET) {
        return res.status(401).send("Unauthorized");
    }

    // Ab ye error nahi dega
    const token = await getUpdateToken();
    if (!token) return res.status(500).send("CJ Token issue.");

    const shardList = shards.split(',');
    let totalDone = 0;
    let nothingLeftToUpdate = true; 

    for (const shardKey of shardList) {
        try {
            const client = clients[shardKey];
            if (!client) continue;

            // SMART QUERY: Sirf wo products jo pichle 22 ghanton mein update NAHI huin
            const products = await client.execute({
                sql: `SELECT id, cj_pid, title FROM products 
                      WHERE cj_pid IS NOT NULL AND cj_pid != '' 
                      AND (last_synced_at < datetime('now', '-22 hours') OR last_synced_at IS NULL)
                      ORDER BY last_synced_at ASC LIMIT 5`
            });

            if (products.rows.length > 0) {
                nothingLeftToUpdate = false; 
                for (const p of products.rows) {
                    try {
                        await sleep(1500); 
                        const cjUrl = `https://developers.cjdropshipping.com/api2.0/v1/product/query?pid=${p.cj_pid}&features=enable_inventory`;
                        const response = await axios.get(cjUrl, { headers: { 'CJ-Access-Token': token } });

                        if (!response.data?.data) continue;

                        const d = response.data.data;
                        const pkrPrice = Math.round(parseFloat(d.sellPrice || 0) * 285);
                        const status = (d.status == 3 && (d.warehouseInventoryNum > 0 || d.totalVerifiedInventory > 0)) ? 'in_stock' : 'out_of_stock';

                        await client.execute({
                            sql: "UPDATE products SET discounted_price = ?, price = ?, quantity = ?, status = ?, last_synced_at = ? WHERE id = ?",
                            args: [pkrPrice, pkrPrice * 1.5, d.warehouseInventoryNum || 0, status, new Date().toISOString(), p.id]
                        });

                        console.log(`✅ [${shardKey}] Updated: ${p.title.substring(0, 20)}...`);
                        totalDone++;

                    } catch (err) { console.log(`❌ PID ${p.cj_pid} failed.`); }
                }
            }
        } catch (e) { console.error(`Shard Error:`, e.message); }
    }

    if (nothingLeftToUpdate) {
        return res.status(200).send("DONE_FOR_TODAY");
    }

    res.status(200).send(`Processed ${totalDone} products.`);
};
import cron from 'node-cron';
import HeroHistory from '../models/HeroHistory.js';
import cloudinary from '../config/cloudinary.js';

/**
 * Initializes the daily cron job to clean up Hero media older than 10 days.
 */
export const initHeroCron = () => {
  console.log('⏰ [HERO CRON]: Initializing Hero Media 10-day Expiry Cron...');
  
  // Run once a day at midnight: 0 0 * * *
  cron.schedule('0 0 * * *', async () => {
    console.log('⏰ [HERO CRON]: Running Hero History cleanup cron task...');
    try {
      const now = new Date();
      // Find records where expiresAt is in the past
      const expiredHeroes = await HeroHistory.find({ expiresAt: { $lt: now } });

      if (expiredHeroes.length === 0) {
        console.log('⏰ [HERO CRON]: No expired hero records found.');
        return;
      }

      console.log(`⏰ [HERO CRON]: Found ${expiredHeroes.length} expired hero records. Processing...`);

      for (const hero of expiredHeroes) {
        try {
          console.log(`⏰ [HERO CRON]: Cleaning up expired hero media: ${hero.cloudinaryPublicId}`);
          
          const destroyResult = await new Promise((resolve, reject) => {
            cloudinary.uploader.destroy(
              hero.cloudinaryPublicId, 
              { resource_type: hero.resourceType || 'video' }, 
              (error, result) => {
                if (error) reject(error);
                else resolve(result);
              }
            );
          });

          console.log(`⏰ [HERO CRON]: Cloudinary response for ${hero.cloudinaryPublicId}:`, destroyResult);

          if (destroyResult && (destroyResult.result === 'ok' || destroyResult.result === 'not_found')) {
            await HeroHistory.findByIdAndDelete(hero._id);
            console.log(`🗑️ [HERO CRON]: Successfully deleted expired hero document: ${hero._id}`);
          } else {
            console.error(`❌ [HERO CRON]: Cloudinary deletion failed for ${hero.cloudinaryPublicId}:`, destroyResult);
          }
        } catch (itemError) {
          console.error(`❌ [HERO CRON]: Error processing deletion for hero item ${hero._id}:`, itemError);
        }
      }
    } catch (err) {
      console.error('🔥 [HERO CRON]: Error in Hero cleanup cron:', err);
    }
  });
};

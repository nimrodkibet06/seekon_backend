import cron from 'node-cron';
import FlashStatus from '../models/FlashStatus.js';
import cloudinary from '../config/cloudinary.js';

/**
 * Initializes the hourly cron job to clean up WhatsApp statuses older than 24 hours.
 */
export const initStatusCron = () => {
  console.log('⏰ [STATUS CRON]: Initializing WhatsApp Status 24h Expiry Cron...');
  
  // Hourly cron job: 0 * * * *
  cron.schedule('0 * * * *', async () => {
    console.log('⏰ [STATUS CRON]: Running WhatsApp Status cleanup cron task...');
    try {
      const expirationTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
      const expiredStatuses = await FlashStatus.find({ createdAt: { $lt: expirationTime } });

      if (expiredStatuses.length === 0) {
        console.log('⏰ [STATUS CRON]: No expired statuses found.');
        return;
      }

      console.log(`⏰ [STATUS CRON]: Found ${expiredStatuses.length} expired status updates. Processing sequentially...`);

      // MUST use sequential loop for memory optimization and stability
      for (const status of expiredStatuses) {
        try {
          console.log(`⏰ [STATUS CRON]: Cleaning up expired status: ${status._id} (Cloudinary ID: ${status.cloudinaryPublicId})`);
          
          // Determine correct resource type for Cloudinary deletion
          const resourceType = status.mediaType === 'video' ? 'video' : 'image';
          
          // Call the Cloudinary API destruction method matching the file's unique public ID
          const destroyResult = await new Promise((resolve, reject) => {
            cloudinary.uploader.destroy(
              status.cloudinaryPublicId, 
              { resource_type: resourceType }, 
              (error, result) => {
                if (error) {
                  reject(error);
                } else {
                  resolve(result);
                }
              }
            );
          });

          console.log(`⏰ [STATUS CRON]: Cloudinary destroy response for ${status.cloudinaryPublicId}:`, destroyResult);

          // Only upon a verified success response from Cloudinary (ok or not_found)
          // should the corresponding MongoDB record be deleted.
          if (destroyResult && (destroyResult.result === 'ok' || destroyResult.result === 'not_found')) {
            await FlashStatus.findByIdAndDelete(status._id);
            console.log(`🗑️ [STATUS CRON]: Successfully deleted expired status document: ${status._id}`);
          } else {
            console.error(`❌ [STATUS CRON]: Cloudinary deletion failed or returned unverified response for ${status.cloudinaryPublicId}:`, destroyResult);
          }
        } catch (itemError) {
          console.error(`❌ [STATUS CRON]: Error processing deletion for status item ${status._id}:`, itemError);
        }
      }
    } catch (err) {
      console.error('🔥 [STATUS CRON]: Error in WhatsApp Status cleanup cron:', err);
    }
  });
};

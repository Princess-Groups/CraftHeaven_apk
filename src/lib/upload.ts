import { supabase } from "@/integrations/supabase/client";

const BUCKET_NAME = "product-images";

/**
 * Verifies the storage bucket exists (created via SQL migration)
 */
export async function ensureBucketExists(): Promise<void> {
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketExists = buckets?.some((b) => b.name === BUCKET_NAME);

  if (!bucketExists) {
    throw new Error(`Storage bucket "${BUCKET_NAME}" not found. Please run the SQL migration to create it.`);
  }
}

/**
 * Uploads an image file to Supabase storage
 * @param file - The file to upload
 * @param productId - Optional product ID to use in the file path
 * @returns The public URL of the uploaded image
 */
export async function uploadProductImage(
  file: File,
  productId?: string
): Promise<string> {
  await ensureBucketExists();

  // Generate a unique filename
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 8);
  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const fileName = `${productId || "temp"}_${timestamp}_${randomStr}.${extension}`;
  const filePath = productId ? `${productId}/${fileName}` : `temp/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (uploadError) {
    console.error("Upload error:", uploadError);
    throw new Error(`Failed to upload image: ${uploadError.message}`);
  }

  // Get the public URL
  const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(filePath);
  return data.publicUrl;
}

/**
 * Deletes an image from Supabase storage
 * @param imageUrl - The public URL of the image to delete
 */
export async function deleteProductImage(imageUrl: string): Promise<void> {
  try {
    // Extract the file path from the public URL
    const url = new URL(imageUrl);
    const pathParts = url.pathname.split("/");
    const bucketIndex = pathParts.findIndex((part) => part === BUCKET_NAME);

    if (bucketIndex === -1 || bucketIndex === pathParts.length - 1) {
      console.warn("Could not extract file path from URL:", imageUrl);
      return;
    }

    const filePath = pathParts.slice(bucketIndex + 1).join("/");

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([filePath]);

    if (error) {
      console.error("Delete error:", error);
      // Don't throw - we don't want to fail the product deletion if image deletion fails
    }
  } catch (err) {
    console.error("Error deleting image:", err);
  }
}

/**
 * Deletes multiple images from Supabase storage
 * @param imageUrls - Array of public URLs to delete
 */
export async function deleteProductImages(imageUrls: string[]): Promise<void> {
  await Promise.all(imageUrls.map((url) => deleteProductImage(url)));
}
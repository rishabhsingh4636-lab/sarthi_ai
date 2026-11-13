export async function createCompactImageThumbnail(
  dataUrl: string,
  maxDimension = 480,
  quality = 0.72,
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl.slice(0, 180000));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const compact = canvas.toDataURL('image/jpeg', quality);
      resolve(compact.length <= 190000 ? compact : '');
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}

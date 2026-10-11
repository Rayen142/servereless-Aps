/**
 * Frame video hanya aman dibaca (BlazeFace maupun canvas) jika elemen sudah ada,
 * punya data frame saat ini, dan dimensi intrinsiknya sudah diketahui.
 */
export const isVideoFrameReady = (
  video: HTMLVideoElement | null,
): video is HTMLVideoElement =>
  video !== null &&
  video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
  video.videoWidth > 0 &&
  video.videoHeight > 0;

/** Menangkap frame video pada resolusi intrinsiknya sebagai data URL JPEG. */
export const captureVideoFrame = (
  video: HTMLVideoElement | null,
  quality: number,
): string | null => {
  if (!isVideoFrameReady(video)) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  try {
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    // Safari iOS membatasi total memori canvas, jadi backing store dilepas segera.
    canvas.width = 0;
    canvas.height = 0;
  }
};

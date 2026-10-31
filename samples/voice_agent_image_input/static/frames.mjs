// Copyright (c) Microsoft Corporation. All rights reserved.
// Browser-side image sizing helpers. Pure functions are covered by test_frames.mjs.

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const FRAME_INTERVAL_MS = 2000;
export const FRAME_MAX_WIDTH = 1280;
export const FRAME_MAX_HEIGHT = 720;
export const FRAME_MAX_BYTES = 2 * 1024 * 1024;
export const FRAME_JPEG_QUALITY = 0.72;

export function validateImageFile(file, maxBytes = MAX_IMAGE_BYTES) {
  if (!file) return "Choose an image first.";
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return "Choose a JPEG, PNG, or WebP image.";
  if (file.size > maxBytes) return `Choose an image no larger than ${Math.floor(maxBytes / 1048576)} MiB.`;
  return "";
}

export function fitFrameSize(width, height, maxWidth = FRAME_MAX_WIDTH, maxHeight = FRAME_MAX_HEIGHT) {
  if (!(width > 0) || !(height > 0)) throw new Error("Frame dimensions must be positive.");
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function dataUrlByteSize(dataUrl) {
  const text = String(dataUrl || "");
  const comma = text.indexOf(",");
  if (comma < 0) return 0;
  const base64 = text.slice(comma + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

// Draw the current video frame to a canvas and encode JPEG; retry once smaller if needed.
export function captureJpeg(video, canvas, { maxWidth = FRAME_MAX_WIDTH, maxHeight = FRAME_MAX_HEIGHT,
  quality = FRAME_JPEG_QUALITY, maxBytes = FRAME_MAX_BYTES } = {}) {
  if (!(video.videoWidth > 0) || !(video.videoHeight > 0)) throw new Error("Camera video is not ready yet.");
  const draw = (size, q) => {
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext("2d", { alpha: false }).drawImage(video, 0, 0, size.width, size.height);
    return canvas.toDataURL("image/jpeg", q);
  };
  let dataUrl = draw(fitFrameSize(video.videoWidth, video.videoHeight, maxWidth, maxHeight), quality);
  if (dataUrlByteSize(dataUrl) <= maxBytes) return dataUrl;
  dataUrl = draw(fitFrameSize(video.videoWidth, video.videoHeight, maxWidth * 0.75, maxHeight * 0.75), quality * 0.8);
  if (dataUrlByteSize(dataUrl) > maxBytes) throw new Error("The camera frame is too large after compression.");
  return dataUrl;
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}

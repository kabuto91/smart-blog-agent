import { prisma } from "./db/client"

export interface UploadData {
  id: string
  filename: string
  mimeType: string
  size: number
  data: string
  createdAt: Date
}

export const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
])

export const MAX_UPLOAD_SIZE = 5 * 1024 * 1024

export async function saveUpload(
  filename: string,
  mimeType: string,
  data: string
): Promise<UploadData> {
  const existing = await prisma.upload.findFirst({ where: { filename } })
  if (existing) return existing
  const size = Buffer.byteLength(data, "base64")
  const upload = await prisma.upload.create({
    data: { filename, mimeType, size, data },
  })
  return upload
}

export async function getUpload(id: string): Promise<UploadData | null> {
  const upload = await prisma.upload.findUnique({ where: { id } })
  return upload
}

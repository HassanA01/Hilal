import { apiClient } from "./client";

export interface UploadImageResponse {
  url: string;
}

export async function uploadImage(file: File): Promise<UploadImageResponse> {
  const formData = new FormData();
  formData.append("image", file);

  const { data } = await apiClient.post<UploadImageResponse>(
    "/uploads/image",
    formData,
    {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 30000,
    },
  );
  return data;
}

package handlers

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

const maxImageUploadSize = 5 << 20 // 5MB

var allowedImageTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/webp": true,
	"image/gif":  true,
}

var allowedImageExts = map[string]bool{
	".jpg":  true,
	".jpeg": true,
	".png":  true,
	".webp": true,
	".gif":  true,
}

func (h *Handler) UploadImage(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(maxImageUploadSize); err != nil {
		writeError(w, http.StatusBadRequest, "file too large (max 5MB)")
		return
	}

	file, header, err := r.FormFile("image")
	if err != nil {
		writeError(w, http.StatusBadRequest, "image file is required")
		return
	}
	defer file.Close()

	if header.Size > maxImageUploadSize {
		writeError(w, http.StatusBadRequest, "file too large (max 5MB)")
		return
	}

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !allowedImageExts[ext] {
		writeError(w, http.StatusBadRequest, "unsupported image type: allowed formats are JPEG, PNG, WebP, GIF")
		return
	}

	data, err := io.ReadAll(io.LimitReader(file, maxImageUploadSize+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read file")
		return
	}
	if int64(len(data)) > maxImageUploadSize {
		writeError(w, http.StatusBadRequest, "file too large (max 5MB)")
		return
	}

	mimeType := http.DetectContentType(data)
	if !allowedImageTypes[mimeType] {
		writeError(w, http.StatusBadRequest, "file content does not match an allowed image type")
		return
	}

	filename := uuid.New().String() + ext
	destPath := filepath.Join(h.uploadsDir, filename)

	dst, err := os.Create(destPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save image")
		return
	}
	defer dst.Close()

	if _, err := dst.Write(data); err != nil {
		os.Remove(destPath)
		writeError(w, http.StatusInternalServerError, "failed to save image")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"url": "/api/v1/uploads/" + filename,
	})
}

func (h *Handler) ServeUpload(w http.ResponseWriter, r *http.Request) {
	filename := filepath.Base(r.URL.Path)

	if filename == "." || filename == ".." || strings.ContainsAny(filename, "/\\") {
		writeError(w, http.StatusBadRequest, "invalid filename")
		return
	}

	filePath := filepath.Join(h.uploadsDir, filename)

	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		writeError(w, http.StatusNotFound, "file not found")
		return
	}

	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, filePath)
}

package handlers

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/HassanA01/Hilal/backend/internal/config"
)

func newTestHandlerWithUploads(t *testing.T) *Handler {
	t.Helper()
	return &Handler{
		config: &config.Config{
			JWTSecret: "test-secret-that-is-long-enough",
		},
		uploadsDir: t.TempDir(),
	}
}

func postImageMultipart(t *testing.T, handler http.HandlerFunc, filename string, fileContent []byte) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	if fileContent != nil {
		part, err := writer.CreateFormFile("image", filename)
		if err != nil {
			t.Fatalf("create form file: %v", err)
		}
		if _, err := part.Write(fileContent); err != nil {
			t.Fatalf("write file content: %v", err)
		}
	}
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	return w
}

// Minimal valid JPEG: SOI marker + JFIF APP0 segment
var minimalJPEG = []byte{
	0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
	0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
	0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9,
}

// Minimal valid PNG: signature + IHDR + IEND
var minimalPNG = []byte{
	0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
	0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
	0xDE, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, // IEND chunk
	0x44, 0xAE, 0x42, 0x60, 0x82,
}

func TestUploadImage_MissingFile(t *testing.T) {
	h := newTestHandlerWithUploads(t)

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	h.UploadImage(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
}

func TestUploadImage_UnsupportedExtension(t *testing.T) {
	h := newTestHandlerWithUploads(t)
	w := postImageMultipart(t, h.UploadImage, "photo.bmp", minimalJPEG)
	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
}

func TestUploadImage_WrongMagicBytes(t *testing.T) {
	h := newTestHandlerWithUploads(t)
	w := postImageMultipart(t, h.UploadImage, "fake.png", []byte("this is not an image"))
	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
}

func TestUploadImage_ValidJPEG(t *testing.T) {
	h := newTestHandlerWithUploads(t)
	w := postImageMultipart(t, h.UploadImage, "photo.jpg", minimalJPEG)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	url := resp["url"]
	if url == "" {
		t.Fatal("expected url in response")
	}
	if !filepath.IsAbs("/"+url) || !contains(url, ".jpg") {
		t.Errorf("unexpected url format: %s", url)
	}

	// Verify file exists on disk
	filename := filepath.Base(url)
	data, err := os.ReadFile(filepath.Join(h.uploadsDir, filename))
	if err != nil {
		t.Fatalf("file not saved: %v", err)
	}
	if !bytes.Equal(data, minimalJPEG) {
		t.Error("saved file content does not match upload")
	}
}

func TestUploadImage_ValidPNG(t *testing.T) {
	h := newTestHandlerWithUploads(t)
	w := postImageMultipart(t, h.UploadImage, "image.png", minimalPNG)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if !contains(resp["url"], ".png") {
		t.Errorf("expected .png in url, got %s", resp["url"])
	}
}

func TestServeUpload_ExistingFile(t *testing.T) {
	h := newTestHandlerWithUploads(t)

	// Write a file to the uploads dir
	filename := "test-image.jpg"
	if err := os.WriteFile(filepath.Join(h.uploadsDir, filename), minimalJPEG, 0o644); err != nil {
		t.Fatalf("write test file: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/uploads/"+filename, nil)
	w := httptest.NewRecorder()
	h.ServeUpload(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	if cc := w.Header().Get("Cache-Control"); !contains(cc, "immutable") {
		t.Errorf("expected immutable cache-control, got %q", cc)
	}
}

func TestServeUpload_PathTraversal(t *testing.T) {
	h := newTestHandlerWithUploads(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/uploads/../etc/passwd", nil)
	w := httptest.NewRecorder()
	h.ServeUpload(w, req)

	// filepath.Base("../etc/passwd") = "passwd" which won't exist
	if w.Code != http.StatusNotFound {
		t.Errorf("want 404, got %d", w.Code)
	}
}

func TestServeUpload_FileNotFound(t *testing.T) {
	h := newTestHandlerWithUploads(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/uploads/nonexistent.png", nil)
	w := httptest.NewRecorder()
	h.ServeUpload(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("want 404, got %d", w.Code)
	}
}

func contains(s, substr string) bool {
	return bytes.Contains([]byte(s), []byte(substr))
}

package docextract

import (
	"archive/zip"
	"bytes"
	"fmt"
	"strings"
	"testing"
)

func TestExtract_Plaintext(t *testing.T) {
	content := "Hello, this is a test document with some content."
	result, err := Extract([]byte(content), "notes.txt")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Text != content {
		t.Errorf("expected %q, got %q", content, result.Text)
	}
	if result.Truncated {
		t.Error("expected Truncated=false")
	}
}

func TestExtract_Markdown(t *testing.T) {
	content := "# Heading\n\nSome paragraph text."
	result, err := Extract([]byte(content), "readme.md")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Text != content {
		t.Errorf("expected %q, got %q", content, result.Text)
	}
}

func TestExtract_EmptyFile(t *testing.T) {
	_, err := Extract([]byte{}, "empty.txt")
	if err == nil {
		t.Fatal("expected error for empty file")
	}
}

func TestExtract_NoReadableText(t *testing.T) {
	_, err := Extract([]byte("   \n\t  \n  "), "whitespace.txt")
	if err == nil {
		t.Fatal("expected error for whitespace-only file")
	}
}

func TestExtract_InvalidUTF8(t *testing.T) {
	data := []byte{0xff, 0xfe, 0x00, 0x01} // invalid UTF-8
	_, err := Extract(data, "binary.txt")
	if err == nil {
		t.Fatal("expected error for invalid UTF-8")
	}
}

func TestExtract_UnsupportedExtension(t *testing.T) {
	_, err := Extract([]byte("data"), "sheet.xlsx")
	if err == nil {
		t.Fatal("expected error for unsupported extension")
	}
	if !strings.Contains(err.Error(), "unsupported") {
		t.Errorf("expected 'unsupported' in error, got %q", err.Error())
	}
}

func TestExtract_DOCX(t *testing.T) {
	docx := makeMinimalDOCX("This is the document body text.")
	result, err := Extract(docx, "test.docx")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(result.Text, "This is the document body text.") {
		t.Errorf("expected extracted text to contain document body, got %q", result.Text)
	}
}

func TestExtract_DOCX_MultipleParagraphs(t *testing.T) {
	docx := makeMultiParagraphDOCX([]string{"First paragraph.", "Second paragraph."})
	result, err := Extract(docx, "multi.docx")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(result.Text, "First paragraph.") || !strings.Contains(result.Text, "Second paragraph.") {
		t.Errorf("expected both paragraphs, got %q", result.Text)
	}
}

func TestExtract_DOCX_BadMagicBytes(t *testing.T) {
	_, err := Extract([]byte("not a zip file"), "fake.docx")
	if err == nil {
		t.Fatal("expected error for invalid DOCX magic bytes")
	}
}

func TestValidateMagicBytes_PDF(t *testing.T) {
	if err := validateMagicBytes([]byte("%PDF-1.4 content"), ".pdf"); err != nil {
		t.Errorf("expected valid PDF magic bytes, got error: %v", err)
	}
	if err := validateMagicBytes([]byte("not a pdf"), ".pdf"); err == nil {
		t.Error("expected error for invalid PDF magic bytes")
	}
}

func TestValidateMagicBytes_DOCX(t *testing.T) {
	data := []byte{'P', 'K', 0x03, 0x04, 0x00}
	if err := validateMagicBytes(data, ".docx"); err != nil {
		t.Errorf("expected valid DOCX magic bytes, got error: %v", err)
	}
	if err := validateMagicBytes([]byte("not a zip"), ".docx"); err == nil {
		t.Error("expected error for invalid DOCX magic bytes")
	}
}

func TestTruncateAtWordBoundary(t *testing.T) {
	tests := []struct {
		name   string
		input  string
		maxLen int
		want   string
	}{
		{"short string", "hello world", 100, "hello world"},
		{"exact boundary", "hello world", 5, "hello"},
		{"mid-word", "hello beautiful world", 12, "hello beauti"}, // space at idx 5 < maxLen/2, so no word-boundary cut
		{"long text", "word1 word2 word3 word4", 11, "word1 word2"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := truncateAtWordBoundary(tt.input, tt.maxLen)
			if got != tt.want {
				t.Errorf("truncateAtWordBoundary(%q, %d) = %q, want %q", tt.input, tt.maxLen, got, tt.want)
			}
		})
	}
}

func TestExtract_Truncation(t *testing.T) {
	// Build a string longer than MaxTextLength.
	word := "test "
	count := (MaxTextLength / len(word)) + 100
	long := strings.Repeat(word, count)

	result, err := Extract([]byte(long), "long.txt")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Truncated {
		t.Error("expected Truncated=true for long text")
	}
	if len(result.Text) > MaxTextLength {
		t.Errorf("expected text length <= %d, got %d", MaxTextLength, len(result.Text))
	}
}

// makeMinimalDOCX creates a minimal valid DOCX (ZIP) with a single paragraph.
func makeMinimalDOCX(text string) []byte {
	buf := new(bytes.Buffer)
	w := zip.NewWriter(buf)
	f, _ := w.Create("word/document.xml")
	fmt.Fprintf(f,
		`<?xml version="1.0" encoding="UTF-8"?>`+
			`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`+
			`<w:body><w:p><w:r><w:t>%s</w:t></w:r></w:p></w:body></w:document>`, text)
	w.Close()
	return buf.Bytes()
}

// makeMultiParagraphDOCX creates a DOCX with multiple paragraphs.
func makeMultiParagraphDOCX(paragraphs []string) []byte {
	buf := new(bytes.Buffer)
	w := zip.NewWriter(buf)
	f, _ := w.Create("word/document.xml")
	fmt.Fprintf(f, `<?xml version="1.0" encoding="UTF-8"?>`+
		`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`)
	for _, p := range paragraphs {
		fmt.Fprintf(f, `<w:p><w:r><w:t>%s</w:t></w:r></w:p>`, p)
	}
	fmt.Fprintf(f, `</w:body></w:document>`)
	w.Close()
	return buf.Bytes()
}

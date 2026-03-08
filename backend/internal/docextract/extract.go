package docextract

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/ledongthuc/pdf"
)

// MaxDocumentSize is the maximum upload size (5MB).
const MaxDocumentSize = 5 << 20

// MaxTextLength is the truncation limit for extracted text.
const MaxTextLength = 50_000

// SupportedExtensions lists allowed file extensions.
var SupportedExtensions = map[string]bool{
	".pdf":  true,
	".docx": true,
	".txt":  true,
	".md":   true,
}

// Result holds the extracted text and whether it was truncated.
type Result struct {
	Text      string
	Truncated bool
}

// Extract reads file content and returns plain text.
// The filename is used to determine format by extension.
func Extract(data []byte, filename string) (Result, error) {
	if len(data) == 0 {
		return Result{}, fmt.Errorf("file is empty")
	}

	ext := strings.ToLower(filepath.Ext(filename))
	if !SupportedExtensions[ext] {
		return Result{}, fmt.Errorf("unsupported file type %q: supported formats are PDF, DOCX, TXT, MD", ext)
	}

	if err := validateMagicBytes(data, ext); err != nil {
		return Result{}, err
	}

	var text string
	var err error

	switch ext {
	case ".pdf":
		text, err = extractPDF(data)
	case ".docx":
		text, err = extractDOCX(data)
	case ".txt", ".md":
		text, err = extractPlaintext(data)
	}
	if err != nil {
		return Result{}, err
	}

	text = strings.TrimSpace(text)
	if text == "" {
		return Result{}, fmt.Errorf("no readable text found in document")
	}

	truncated := false
	if len(text) > MaxTextLength {
		text = truncateAtWordBoundary(text, MaxTextLength)
		truncated = true
	}

	return Result{Text: text, Truncated: truncated}, nil
}

func extractPDF(data []byte) (string, error) {
	reader, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", fmt.Errorf("failed to parse PDF: %w", err)
	}

	var buf strings.Builder
	for i := 1; i <= reader.NumPage(); i++ {
		page := reader.Page(i)
		if page.V.IsNull() {
			continue
		}
		text, err := page.GetPlainText(nil)
		if err != nil {
			continue
		}
		buf.WriteString(text)
		buf.WriteString("\n")
	}
	return buf.String(), nil
}

func extractDOCX(data []byte) (string, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", fmt.Errorf("failed to open DOCX: %w", err)
	}

	for _, f := range zr.File {
		if f.Name != "word/document.xml" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return "", fmt.Errorf("failed to read document.xml: %w", err)
		}
		defer rc.Close()
		return parseDocXML(rc)
	}
	return "", fmt.Errorf("word/document.xml not found in DOCX")
}

// parseDocXML extracts text from the Word document XML by collecting <w:t> elements.
func parseDocXML(r io.Reader) (string, error) {
	decoder := xml.NewDecoder(r)
	var buf strings.Builder
	inText := false
	lastWasParagraph := false

	for {
		tok, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", fmt.Errorf("failed to parse document XML: %w", err)
		}

		switch t := tok.(type) {
		case xml.StartElement:
			if t.Name.Local == "t" {
				inText = true
			}
			if t.Name.Local == "p" && buf.Len() > 0 && !lastWasParagraph {
				buf.WriteString("\n")
				lastWasParagraph = true
			}
		case xml.EndElement:
			if t.Name.Local == "t" {
				inText = false
			}
		case xml.CharData:
			if inText {
				buf.Write(t)
				lastWasParagraph = false
			}
		}
	}
	return buf.String(), nil
}

func extractPlaintext(data []byte) (string, error) {
	if !utf8.Valid(data) {
		return "", fmt.Errorf("file is not valid UTF-8 text")
	}
	return string(data), nil
}

func validateMagicBytes(data []byte, ext string) error {
	switch ext {
	case ".pdf":
		if len(data) < 4 || string(data[:4]) != "%PDF" {
			return fmt.Errorf("file does not appear to be a valid PDF")
		}
	case ".docx":
		if len(data) < 4 || data[0] != 'P' || data[1] != 'K' || data[2] != 0x03 || data[3] != 0x04 {
			return fmt.Errorf("file does not appear to be a valid DOCX")
		}
	case ".txt", ".md":
		// Check first 512 bytes are valid UTF-8.
		sample := data
		if len(sample) > 512 {
			sample = sample[:512]
		}
		if !utf8.Valid(sample) {
			return fmt.Errorf("file does not appear to be valid text")
		}
	}
	return nil
}

func truncateAtWordBoundary(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	truncated := s[:maxLen]
	// Find the last space to avoid cutting a word in half.
	if idx := strings.LastIndex(truncated, " "); idx > maxLen/2 {
		truncated = truncated[:idx]
	}
	return truncated
}

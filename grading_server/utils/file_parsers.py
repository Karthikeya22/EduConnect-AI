"""
parsers.py
File parsers for PDF, DOCX, and plain text submissions.
"""

import io


def parse_submission(file_bytes: bytes, content_type: str) -> str:
    """
    Parse a submission file into plain text.
    Supports: application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, text/*
    """
    ct = content_type.lower()

    if "pdf" in ct:
        return _parse_pdf(file_bytes)
    elif "wordprocessingml" in ct or "docx" in ct:
        return _parse_docx(file_bytes)
    elif "presentationml" in ct or "pptx" in ct:
        return _parse_pptx(file_bytes)
    elif "ms-powerpoint" in ct or "ppt" in ct:
        return "This is a legacy .ppt file; content could not be extracted for AI grading. Please review manually."
    elif "text" in ct:
        return file_bytes.decode("utf-8", errors="replace")
    else:
        # Try plain text as fallback
        try:
            return file_bytes.decode("utf-8", errors="replace")
        except Exception:
            raise ValueError(f"Unsupported content type: {content_type}")


def _parse_pdf(file_bytes: bytes) -> str:
    """Extract text from a PDF using PyMuPDF (fitz)."""
    import fitz  # PyMuPDF

    doc = fitz.open(stream=file_bytes, filetype="pdf")
    pages: list[str] = []
    for page in doc:
        text = page.get_text("text")
        if text.strip():
            pages.append(text.strip())
    doc.close()
    return "\n\n".join(pages)


def _parse_docx(file_bytes: bytes) -> str:
    """Extract text from a DOCX file using python-docx."""
    from docx import Document

    doc = Document(io.BytesIO(file_bytes))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    return "\n\n".join(paragraphs)


def _parse_pptx(file_bytes: bytes) -> str:
    """Extract text from a PPTX file using python-pptx."""
    from pptx import Presentation
    import io

    prs = Presentation(io.BytesIO(file_bytes))
    lines = []
    for i, slide in enumerate(prs.slides, start=1):
        lines.append(f"=== Slide {i} ===")
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    text = para.text.strip()
                    if text:
                        lines.append(text)
        lines.append("")
    return "\n".join(lines)

"""
Split a PDF textbook into separate chapter text files.
 
Strategy (in order):
    1. Try PDF bookmarks/outline (most textbooks have these)
    2. Fall back to regex-based detection (scans for "Chapter X" patterns in text)
 
Usage:
    python Seperate_By_Chapter_Final.py <input.pdf> [--output-dir ~/Downloads/chapters] [--dry-run]
 
Requirements:
    pip install pypdf pdfplumber
"""
 
import argparse
import re
import sys
from pathlib import Path
 
import pdfplumber
from pypdf import PdfReader
 
 
def sanitize_filename(name: str, max_len: int = 80) -> str:
    """Convert a chapter title into a safe filename."""
    name = re.sub(r'[<>:"/\\|?*]', '', name)
    name = re.sub(r'\s+', '_', name.strip())
    name = re.sub(r'_+', '_', name)
    return name[:max_len]
 
 
# ---------------------------------------------------------------------------
# Strategy 1: PDF Bookmarks / Outline
# ---------------------------------------------------------------------------
 
def get_chapters_from_bookmarks(reader: PdfReader) -> list[dict]:
    """Extract top-level bookmarks as chapter boundaries."""
    try:
        outlines = reader.outline
    except Exception:
        return []
 
    if not outlines:
        return []
 
    chapters = []
 
    def process_outline(items, depth=0):
        for item in items:
            if isinstance(item, list):
                # Nested list = sub-bookmarks, skip (we only want top-level)
                continue
            else:
                try:
                    page_num = reader.get_destination_page_number(item)
                    title = item.title.strip()
                    chapters.append({
                        "title": title,
                        "start_page": page_num,  # already 0-based
                    })
                except Exception:
                    continue
 
    process_outline(outlines)
    return chapters
 
 
def filter_chapter_bookmarks(chapters: list[dict]) -> list[dict]:
    """
    Filter bookmarks to only include actual chapters.
 
    Keeps entries that match common chapter patterns.
    If filtering removes everything or keeps fewer than 30% of bookmarks
    (indicating non-standard naming conventions), returns the original list.
    """
    chapter_patterns = [
        r'(?i)^chapter\s+\d+',          # Chapter 1, Chapter 12
        r'(?i)^ch\.?\s*\d+',            # Ch 1, Ch.1
        r'(?i)^\d+[\.\s]',              # 1. Introduction, 1 Introduction
        r'(?i)^part\s+\w+',             # Part I, Part 1
        r'(?i)^unit\s+\d+',             # Unit 1
        r'(?i)^module\s+\d+',           # Module 1
        r'(?i)^appendix',               # Appendix
        r'(?i)^(preface|introduction|foreword|conclusion|glossary|index|bibliography|references)',
    ]
 
    filtered = []
    for ch in chapters:
        for pattern in chapter_patterns:
            if re.search(pattern, ch["title"]):
                filtered.append(ch)
                break
 
    # If filtering removed everything, the bookmarks might use non-standard naming
    # Return all top-level bookmarks in that case
    if not filtered:
        return chapters
 
    # If filtering kept fewer than 30% of bookmarks, the naming convention is
    # non-standard (e.g. "1. The way of the program" style) — keep all bookmarks
    if len(filtered) < len(chapters) * 0.3:
        print("  Warning: filter kept fewer than 30% of bookmarks — assuming non-standard "
              "chapter naming and using all top-level bookmarks instead.")
        return chapters
 
    return filtered
 
 
# ---------------------------------------------------------------------------
# Strategy 2: Regex-based text scanning
# ---------------------------------------------------------------------------
 
def get_chapters_from_text(pdf_path: str, total_pages: int) -> list[dict]:
    """Scan page text for 'Chapter X' style headings."""
    print("Scanning pages for chapter headings (this may take a minute)...")
 
    chapter_pattern = re.compile(
        r'^\s*(chapter\s+\d+|ch\.?\s*\d+)',
        re.IGNORECASE | re.MULTILINE
    )
 
    chapters = []
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            # Only check the top portion of the page (chapter titles are usually at top)
            top_text = text[:500]
            match = chapter_pattern.search(top_text)
            if match:
                # Try to grab the full chapter title (rest of the line)
                line_match = re.search(
                    r'(?i)(chapter\s+\d+[^\n]*)',
                    top_text
                )
                title = line_match.group(1).strip() if line_match else match.group(1).strip()
                chapters.append({
                    "title": title,
                    "start_page": i,
                })
                print(f"  Found: '{title}' (page {i + 1})")
 
    return chapters
 
 
# ---------------------------------------------------------------------------
# Extraction logic
# ---------------------------------------------------------------------------
 
def extract_chapters_as_text(pdf_path: str, chapters: list[dict], output_dir: Path, total_pages: int):
    """Extract each chapter's text and write to individual .txt files."""
    with pdfplumber.open(pdf_path) as pdf:
        for i, chapter in enumerate(chapters):
            start = chapter["start_page"]
            end = chapters[i + 1]["start_page"] - 1 if i + 1 < len(chapters) else total_pages - 1
 
            if end < start:
                print(f"  Skipping '{chapter['title']}' — invalid page range")
                continue
 
            # Extract and join text from each page in the chapter
            pages_text = []
            for page_idx in range(start, end + 1):
                page_text = pdf.pages[page_idx].extract_text() or ""
                if page_text.strip():
                    pages_text.append(page_text)
 
            chapter_text = "\n\n".join(pages_text)
 
            safe_title = sanitize_filename(chapter["title"])
            filename = f"{i + 1:02d}_{safe_title}.txt"
            out_path = output_dir / filename
 
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(f"{chapter['title']}\n")
                f.write("=" * len(chapter["title"]) + "\n\n")
                f.write(chapter_text)
 
            print(f"  [{start + 1}-{end + 1}] → {filename} ({end - start + 1} pages, {len(chapter_text)} chars)")
 
 
def main():
    parser = argparse.ArgumentParser(description="Split a PDF textbook into chapter text files.")
    parser.add_argument("input_pdf", help="Path to the input PDF textbook")
    parser.add_argument(
        "--output-dir",
        default=str(Path.home() / "Downloads" / "chapters"),
        help="Output directory (default: ~/Downloads/chapters)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Only detect chapters, don't extract")
    parser.add_argument(
        "--no-filter", action="store_true",
        help="Use ALL top-level bookmarks as chapters (don't filter by naming pattern)",
    )
    args = parser.parse_args()
 
    pdf_path = Path(args.input_pdf)
    if not pdf_path.exists():
        print(f"Error: '{pdf_path}' not found.")
        sys.exit(1)
 
    reader = PdfReader(str(pdf_path))
    total_pages = len(reader.pages)
    print(f"Input: {pdf_path.name} ({total_pages} pages)\n")
 
    # Strategy 1: Bookmarks
    print("Checking for PDF bookmarks/outline...")
    chapters = get_chapters_from_bookmarks(reader)
 
    if chapters:
        print(f"  Found {len(chapters)} top-level bookmarks.")
 
        if not args.no_filter:
            filtered = filter_chapter_bookmarks(chapters)
            print(f"  After filtering to chapter-like entries: {len(filtered)}")
            if len(filtered) < len(chapters):
                print("  (Use --no-filter to keep all top-level bookmarks)\n")
            chapters = filtered
 
        print("\nDetected chapters:")
        for ch in chapters:
            print(f"  Page {ch['start_page'] + 1}: {ch['title']}")
    else:
        print("  No bookmarks found.\n")
 
    # Strategy 2: Text-based regex fallback
    if not chapters:
        print("Falling back to text-based chapter detection...\n")
        chapters = get_chapters_from_text(str(pdf_path), total_pages)
 
    if not chapters:
        print("\nCould not detect any chapter boundaries.")
        print("Possible fixes:")
        print("  - Check if the PDF uses non-standard chapter naming")
        print("  - Try --no-filter if bookmarks exist but were filtered out")
        sys.exit(1)
 
    print(f"\n{len(chapters)} chapter(s) detected.\n")
 
    if args.dry_run:
        print("Dry run — no files written.")
        return
 
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
 
    print(f"Extracting text into '{output_dir}/':")
    extract_chapters_as_text(str(pdf_path), chapters, output_dir, total_pages)
 
    print(f"\nDone. {len(chapters)} chapter text file(s) saved to '{output_dir}/'.")
 
 
if __name__ == "__main__":
    main()
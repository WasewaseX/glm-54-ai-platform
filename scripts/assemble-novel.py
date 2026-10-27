#!/usr/bin/env python3
"""Assemble the Book Forge manuscript into deliverables: .md, .txt, .pdf.

Reads books/<book>/manuscript/ch*.md (Chapter N — Title on line 1) and produces:
  public/deliverables/<slug>.md
  public/deliverables/<slug>.pdf
"""
import glob
import json
import re
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    Paragraph,
    Spacer,
    PageBreak,
)

BOOK = sys.argv[1] if len(sys.argv) > 1 else "the-dreaming-vat"
ROOT = "/home/z/my-project"
BOOK_DIR = f"{ROOT}/books/{BOOK}"
OUT_MD = f"{ROOT}/public/deliverables/{BOOK}.md"
OUT_PDF = f"{ROOT}/public/deliverables/{BOOK}.pdf"

# ---------------- gather chapters ----------------
files = sorted(glob.glob(f"{BOOK_DIR}/manuscript/ch*.md"))
chapters = []
for path in files:
    raw = open(path, encoding="utf-8").read().strip()
    if not raw:
        continue
    first, _, body = raw.partition("\n")
    m = re.match(r"Chapter\s+(\d+)\s*[—–-]\s*(.+)", first.strip())
    num = int(m.group(1)) if m else len(chapters) + 1
    title = m.group(2).strip() if m else first.strip()
    chapters.append((num, title, body.strip()))

chapters.sort(key=lambda c: c[0])
total_words = sum(len(re.findall(r"\S+", body)) for _, _, body in chapters)
state = json.load(open(f"{BOOK_DIR}/state.json"))
print(f"chapters: {len(chapters)} | words: {total_words:,} | phase: {state.get('phase')}")

# ---------------- markdown ----------------
md = [
    f"# {state.get('title', BOOK)}\n",
    f"*An original serialized novel — written by the GLM 5.4 AI Book Forge pipeline.*\n",
    f"{len(chapters)} chapters · {total_words:,} words\n",
    "\n---\n",
]
for num, title, body in chapters:
    md.append(f"\n## Chapter {num} — {title}\n\n{body}\n")
open(OUT_MD, "w", encoding="utf-8").write("\n".join(md))
print(f"wrote {OUT_MD}")

# ---------------- PDF ----------------
INK = colors.HexColor("#101418")
MUTED = colors.HexColor("#5B6672")
ACCENT = colors.HexColor("#2E6E63")
PAPER = colors.HexColor("#FBFAF7")

styles = {
    "chapter": ParagraphStyle(
        "chapter", fontName="Georgia-Bold", fontSize=17, leading=23,
        spaceBefore=18, spaceAfter=14, textColor=INK,
    ),
    "body": ParagraphStyle(
        "body", fontName="Georgia", fontSize=10.5, leading=17.5,
        alignment=TA_JUSTIFY, textColor=INK, spaceAfter=7,
    ),
    "break": ParagraphStyle(
        "break", fontName="Georgia", fontSize=12, leading=18,
        alignment=TA_CENTER, textColor=MUTED, spaceBefore=8, spaceAfter=8,
    ),
    "coverTitle": ParagraphStyle(
        "coverTitle", fontName="Georgia-Bold", fontSize=34, leading=42,
        alignment=TA_CENTER, textColor=INK, spaceAfter=10,
    ),
    "coverSub": ParagraphStyle(
        "coverSub", fontName="Georgia-Italic", fontSize=13, leading=20,
        alignment=TA_CENTER, textColor=MUTED, spaceAfter=6,
    ),
}

def on_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
    canvas.setFillColor(MUTED)
    canvas.setFont("Georgia", 8)
    canvas.drawString(22 * mm, 14 * mm, state.get("title", BOOK))
    canvas.drawRightString(A4[0] - 22 * mm, 14 * mm, str(canvas.getPageNumber()))
    canvas.setStrokeColor(colors.HexColor("#D8D4CC"))
    canvas.setLineWidth(0.4)
    canvas.line(22 * mm, 17 * mm, A4[0] - 22 * mm, 17 * mm)
    canvas.restoreState()

doc = BaseDocTemplate(
    OUT_PDF, pagesize=A4,
    leftMargin=24 * mm, rightMargin=24 * mm, topMargin=22 * mm, bottomMargin=22 * mm,
    title=state.get("title", BOOK), author="GLM 5.4 AI — Book Forge",
)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
doc.addPageTemplates([PageTemplate(id="page", frames=[frame], onPage=on_page)])

story = []
story.append(Spacer(1, 120 * mm))
story.append(Paragraph(state.get("title", BOOK), styles["coverTitle"]))
story.append(Paragraph("A novel written by the GLM 5.4 AI Book Forge", styles["coverSub"]))
story.append(Spacer(1, 6 * mm))
story.append(Paragraph(f"{len(chapters)} chapters · {total_words:,} words", styles["coverSub"]))
story.append(PageBreak())

for num, title, body in chapters:
    story.append(Paragraph(f"Chapter {num} — {title}", styles["chapter"]))
    for block in body.split("* * *"):
        block = block.strip()
        if not block:
            continue
        for para in block.split("\n\n"):
            para = para.strip().replace("\n", " ")
            if not para:
                continue
            para = para.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            story.append(Paragraph(para, styles["body"]))
        story.append(Paragraph("* * *", styles["break"]))
    if story and isinstance(story[-1], Paragraph) and story[-1].text == "* * *":
        story.pop()  # no trailing break at chapter end
    story.append(PageBreak())

doc.build(story)
print(f"wrote {OUT_PDF}")

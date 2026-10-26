#!/usr/bin/env python3
"""Build the body PDF for THE DARK GENOME (Book One: Greyharbor Bloom).

Chapter Numbering Plan (report.md Step 3.5):
- Front matter: "Contents" page — unnumbered, not a TOC entry.
- Body: chapters keep their manuscript numbers 1..30 (H1 level-0 TOC entries).
- Epilogue: unnumbered back-matter heading, own TOC entry.
TOC GATE: YES -> TocDocTemplate + doc.multiBuild(story) + bookmark attrs.
"""
import os
import re
import hashlib
from xml.sax.saxutils import escape

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER, TA_LEFT
from reportlab.lib.colors import HexColor
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, CondPageBreak, HRFlowable,
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

BASE = '/home/z/my-project/novel'
MS = os.path.join(BASE, 'manuscript')
OUT = os.path.join(BASE, 'build', 'body.pdf')

INK = HexColor('#1c1a17')
MUTED = HexColor('#6f6a60')
GOLD = HexColor('#8a6d1f')
RULE = HexColor('#c9b98a')

FONT_DIR = '/usr/share/fonts/truetype'
pdfmetrics.registerFont(TTFont('BookSerif', f'{FONT_DIR}/liberation/LiberationSerif-Regular.ttf'))
pdfmetrics.registerFont(TTFont('BookSerif-Bold', f'{FONT_DIR}/liberation/LiberationSerif-Bold.ttf'))
pdfmetrics.registerFont(TTFont('BookSerif-Italic', f'{FONT_DIR}/liberation/LiberationSerif-Italic.ttf'))
pdfmetrics.registerFont(TTFont('BookSerif-BoldItalic', f'{FONT_DIR}/liberation/LiberationSerif-BoldItalic.ttf'))
registerFontFamily('BookSerif', normal='BookSerif', bold='BookSerif-Bold',
                   italic='BookSerif-Italic', boldItalic='BookSerif-BoldItalic')

# ---------- styles ----------
kicker_style = ParagraphStyle(
    'Kicker', fontName='BookSerif-Bold', fontSize=10.5, leading=14,
    textColor=GOLD, alignment=TA_LEFT, spaceBefore=0, spaceAfter=10,
)
chapter_title_style = ParagraphStyle(
    'ChapterTitle', fontName='BookSerif-Bold', fontSize=21.5, leading=27,
    textColor=INK, alignment=TA_LEFT, spaceBefore=0, spaceAfter=4,
)
body_style = ParagraphStyle(
    'Body', fontName='BookSerif', fontSize=11.5, leading=19.2,
    textColor=INK, alignment=TA_JUSTIFY, firstLineIndent=18,
    spaceBefore=0, spaceAfter=2,
)
body_first_style = ParagraphStyle('BodyFirst', parent=body_style, firstLineIndent=0)
scene_style = ParagraphStyle(
    'Scene', fontName='BookSerif', fontSize=11.5, leading=19.2,
    textColor=MUTED, alignment=TA_CENTER, spaceBefore=10, spaceAfter=10,
)
toc_heading_style = ParagraphStyle(
    'ContentsHead', fontName='BookSerif-Bold', fontSize=21.5, leading=27,
    textColor=INK, spaceBefore=6, spaceAfter=16,
)
toc_l0 = ParagraphStyle(
    'TOCLevel0', fontName='BookSerif', fontSize=11.5, leading=21,
    textColor=INK, leftIndent=6,
)


class TocDocTemplate(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if hasattr(flowable, 'bookmark_name'):
            level = getattr(flowable, 'bookmark_level', 0)
            text = getattr(flowable, 'bookmark_text', '')
            key = getattr(flowable, 'bookmark_key', '')
            self.notify('TOCEntry', (level, text, self.page, key))


def add_heading(kicker_text, title_text, level=0, toc_text=None):
    """Chapter opener: kicker + title + gold rule; title carries TOC bookmark."""
    key = 'h_' + hashlib.md5(title_text.encode()).hexdigest()[:8]
    p = Paragraph(f'<a name="{key}"/>{escape(title_text)}', chapter_title_style)
    p.bookmark_name = key
    p.bookmark_level = level
    p.bookmark_text = toc_text or title_text
    p.bookmark_key = key
    block = [
        Paragraph(escape(kicker_text.upper()), kicker_style),
        p,
        HRFlowable(width='30%', thickness=1.1, color=RULE, spaceBefore=6,
                   spaceAfter=22, hAlign='LEFT'),
    ]
    return block


def clean(text):
    text = text.replace('\u00a0', ' ')
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)', r'\1', text)
    text = re.sub(r'_{2,}(.+?)_{2,}', r'\1', text)
    return escape(text.strip())


def chapter_flowables(path):
    with open(path, 'r', encoding='utf-8') as fh:
        raw = fh.read().strip()
    lines = raw.split('\n')
    head = lines[0].strip()
    m = re.match(r'^##\s+(Chapter\s+(\d+)|Epilogue)\s*[—–-]\s*(.+)$', head)
    if not m:
        raise ValueError(f'Unparsable heading in {path}: {head!r}')
    is_epilogue = m.group(1) == 'Epilogue'
    num = m.group(2)
    title = m.group(3).strip()
    kicker = 'Epilogue' if is_epilogue else f'Chapter {int(num)}'
    toc_text = (f'Epilogue — {title}' if is_epilogue
                else f'{int(num)}.  {title}')

    flows = [CondPageBreak(0.60 * 706)]  # start chapters on fresh pages when >35% used
    flows += add_heading(kicker, title, level=0, toc_text=toc_text)

    body = '\n'.join(lines[1:]).strip()
    blocks = [b.strip() for b in re.split(r'\n\s*\n', body) if b.strip()]
    first_para = True
    for block in blocks:
        flat = ' '.join(line.strip() for line in block.split('\n')).strip()
        if re.fullmatch(r'\*\s*\*\s*\*', flat):
            flows.append(Paragraph('* * *', scene_style))
            first_para = True
            continue
        style = body_first_style if first_para else body_style
        flows.append(Paragraph(clean(flat), style))
        first_para = False
    flows.append(Spacer(1, 10))
    return flows


def on_page(canvas, doc):
    canvas.saveState()
    canvas.setFont('BookSerif', 9.5)
    canvas.setFillColor(MUTED)
    canvas.drawCentredString(A4[0] / 2.0, 13 * mm, str(doc.page))
    canvas.restoreState()


def build():
    files = [os.path.join(MS, f'ch{i:02d}.md') for i in range(1, 31)]
    files.append(os.path.join(MS, 'epilogue.md'))
    for f in files:
        if not os.path.exists(f):
            raise FileNotFoundError(f)

    doc = TocDocTemplate(
        OUT, pagesize=A4,
        leftMargin=26 * mm, rightMargin=26 * mm,
        topMargin=24 * mm, bottomMargin=24 * mm,
        title='The Dark Genome — Book One: Greyharbor Bloom',
        author='Z.ai',
    )

    story = []
    # ---- Contents (front matter, unnumbered) ----
    story.append(Paragraph('Contents', toc_heading_style))
    story.append(HRFlowable(width='30%', thickness=1.1, color=RULE,
                            spaceBefore=0, spaceAfter=18, hAlign='LEFT'))
    toc = TableOfContents()
    toc.levelStyles = [toc_l0]
    story.append(toc)
    story.append(PageBreak())

    for f in files:
        story.extend(chapter_flowables(f))

    doc.multiBuild(story, onFirstPage=on_page, onLaterPages=on_page)
    print('body built:', OUT)


if __name__ == '__main__':
    build()

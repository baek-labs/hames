import sys
import os
import io

try:
    import fitz
    HAS_FITZ = True
except ImportError:
    HAS_FITZ = False

try:
    import pdfplumber
    HAS_PDFPLUMBER = True
except ImportError:
    HAS_PDFPLUMBER = False

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

try:
    import pandas as pd
    from deep_translator import GoogleTranslator
    HAS_TRANSLATOR_PANDAS = True
except ImportError:
    HAS_TRANSLATOR_PANDAS = False


class PDFManager:
    """PDF Toolkit consolidating design analysis, text/color extraction, and translation to excel."""

    @staticmethod
    def analyze_design(pdf_path):
        """Check PDF pages, text length, and images count."""
        if not HAS_FITZ:
            print("PyMuPDF (fitz) is required for design analysis.")
            return

        try:
            doc = fitz.open(pdf_path)
            print(f"Total pages: {len(doc)}")
            for page_num in range(min(3, len(doc))):
                page = doc[page_num]
                images = page.get_images()
                text = page.get_text()
                print(f"Page {page_num+1}: {len(images)} images, text length: {len(text.strip())}")
        except Exception as e:
            print(f"Error opening PDF: {e}")

    @staticmethod
    def extract_dominant_colors(pdf_path, max_colors=5):
        """Extract dominant colors from the first image of the PDF's first page."""
        if not (HAS_FITZ and HAS_PIL):
            print("PyMuPDF (fitz) and Pillow (PIL) are required for color extraction.")
            return

        try:
            doc = fitz.open(pdf_path)
            page = doc[0]
            images = page.get_images()
            if not images:
                print("No images found on page 0")
                return

            xref = images[0][0]
            base_image = doc.extract_image(xref)
            image_bytes = base_image["image"]

            image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            image.thumbnail((200, 200)) # Speed up
            
            colors = image.getcolors(maxcolors=40000)
            colors = sorted(colors, key=lambda x: x[0], reverse=True)
            
            print("--- Dominant Colors ---")
            for count, color in colors[:max_colors]:
                hex_color = '#%02x%02x%02x' % color
                print(f"{hex_color} : {count} pixels")
        except Exception as e:
            print(f"Color extraction error: {e}")

    @staticmethod
    def extract_text(pdf_path, output_path):
        """Extract raw text using pdfplumber."""
        if not HAS_PDFPLUMBER:
            print("pdfplumber is required for text extraction.")
            return

        print(f"Extracting text from {pdf_path}...")
        text_content = ""
        try:
            with pdfplumber.open(pdf_path) as pdf:
                for page in pdf.pages:
                    ext = page.extract_text()
                    if ext:
                        text_content += ext + "\\n\\n"
            
            if text_content:
                with open(output_path, "w", encoding="utf-8") as f:
                    f.write(text_content)
                print(f"Text saved to {output_path}")
            else:
                print("No text extracted.")
        except Exception as e:
            print(f"Extraction failed: {e}")

    @staticmethod
    def translate_and_export_to_excel(pdf_path, output_path, index_path=None):
        """Extract tables, translate to Korean, and save to Excel."""
        if not (HAS_PDFPLUMBER and HAS_TRANSLATOR_PANDAS):
            print("pdfplumber, pandas, and deep_translator are required.")
            return

        translator = GoogleTranslator(source='auto', target='ko')

        def translate_text(text):
            if not text or not isinstance(text, str) or not text.strip():
                return text
            text = text.replace('\\n', ' ')
            try:
                return translator.translate(text)
            except Exception as e:
                print(f"Error translating: {text[:30]}... -> {e}")
                return text

        print("Extracting and translating tables to Excel...")
        sheets_data = {}
        try:
            with pdfplumber.open(pdf_path) as pdf:
                for i, page in enumerate(pdf.pages):
                    print(f"Processing page {i+1}...")
                    tables = page.extract_tables()
                    for j, table in enumerate(tables):
                        translated_data = []
                        for row in table:
                            translated_row = [translate_text(cell) for cell in row]
                            translated_data.append(translated_row)
                        
                        if len(translated_data) > 1:
                            headers = translated_data[0]
                            valid_headers = []
                            for idx, h in enumerate(headers):
                                h_str = str(h) if h else f"Unnamed_{idx}"
                                if h_str in valid_headers:
                                    h_str = f"{h_str}_{idx}"
                                valid_headers.append(h_str)
                            df = pd.DataFrame(translated_data[1:], columns=valid_headers)
                        elif len(translated_data) == 1:
                            df = pd.DataFrame([translated_data[0]])
                        else:
                            df = pd.DataFrame()
                            
                        if not df.empty:
                            sheet_name = f"Page_{i+1}_Table_{j+1}"
                            sheets_data[sheet_name] = df

            if sheets_data:
                with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
                    for sheet_name, df in sheets_data.items():
                        df.to_excel(writer, sheet_name=sheet_name, index=False)
                        print(f"Saved {sheet_name} to excel.")
                print(f"\\nExcel file created successfully at: {output_path}")
                
                # Update index if provided
                if index_path:
                    filename = os.path.basename(output_path)
                    if os.path.exists(index_path):
                        with open(index_path, "a", encoding="utf-8") as f:
                            f.write(f"\\n- [{filename}](./{filename}) - PDF Translation Output\\n")
                        print("Appended to _Index.md")
                    else:
                        with open(index_path, "w", encoding="utf-8") as f:
                            f.write(f"# Internal Docs Index\\n\\n## 관련노트\\n- [{filename}](./{filename}) - PDF Translation Output\\n")
                        print("Created _Index.md")
            else:
                print("No tables found to extract.")
        except Exception as e:
            print(f"Error during translation flow: {e}")

if __name__ == "__main__":
    print("PDFManager loaded. Call static methods to use functionalities.")

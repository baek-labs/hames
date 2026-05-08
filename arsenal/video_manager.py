import sys
import os
import time

try:
    import google.generativeai as genai
    HAS_GENAI = True
except ImportError:
    HAS_GENAI = False

class VideoManager:
    """Toolkit for extracting text and transcriptions from video files using Generative AI."""

    @staticmethod
    def extract_transcript(video_paths: list, output_path: str, api_key: str, prompt: str = None):
        """Upload videos to Gemini and extract detailed transcript/summary."""
        if not HAS_GENAI:
            print("[ERROR/RCA] google.generativeai library is required for video extraction.")
            return

        if not prompt:
            prompt = "Please provide a detailed transcript and a summary of the key points from this video."

        try:
            genai.configure(api_key=api_key)
        except Exception as e:
            print(f"[ERROR/RCA] Failed to configure API: {e}")
            return

        print(f"=== VideoManager | Target: Extract Transcripts for {len(video_paths)} videos ===")
        
        try:
            with open(output_path, "w", encoding="utf-8") as f:
                for path in video_paths:
                    filename = os.path.basename(path)
                    f.write(f"\n\n--- Analysis for {filename} ---\n")
                    print(f"Uploading {filename}...")
                    
                    try:
                        video_file = genai.upload_file(path=path)
                        
                        while video_file.state.name == "PROCESSING":
                            print(".", end="", flush=True)
                            time.sleep(5)
                            video_file = genai.get_file(video_file.name)
                            
                        if video_file.state.name == "FAILED":
                            error_msg = f"FAILED Processing Video: {filename}"
                            f.write(error_msg + "\n")
                            print(f"\n[ERROR/RCA] {error_msg}")
                            continue
                        
                        print(f"\nGenerating content for {filename}...")
                        model = genai.GenerativeModel(model_name="models/gemini-1.5-pro")
                        response = model.generate_content([video_file, prompt])
                        
                        f.write(response.text)
                        print(f"[CLEANED/DONE] {filename} Processed.")
                    except Exception as e:
                        error_msg = f"Error processing {filename}: {e}"
                        f.write(error_msg + "\n")
                        print(f"\n[ERROR/RCA] {error_msg}")
            print(f"=== All extraction Tasks Completed. Saved to: {output_path} ===")
        except Exception as e:
            print(f"[ERROR/RCA] Failed to open or write to output path: {e}")

if __name__ == "__main__":
    print("VideoManager loaded. Call static methods to use functionalities.")

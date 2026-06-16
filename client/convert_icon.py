import os
from PIL import Image

def convert_png_to_ico(png_path, ico_path):
    print(f"Reading PNG source from: {png_path}")
    if not os.path.exists(png_path):
        print(f"Error: Source PNG does not exist at {png_path}")
        return False
        
    try:
        # Open the image
        img = Image.open(png_path)
        
        # Define standard icon sizes for Windows
        icon_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
        
        # Ensure the output directory exists
        out_dir = os.path.dirname(ico_path)
        if out_dir and not os.path.exists(out_dir):
            os.makedirs(out_dir, exist_ok=True)
            
        # Save as ICO with multiple sizes embedded
        img.save(ico_path, sizes=icon_sizes)
        print(f"Successfully converted and saved multi-resolution ICO to: {ico_path}")
        return True
    except Exception as e:
        print(f"Conversion failed: {e}")
        return False

if __name__ == "__main__":
    src_png = r"C:\Users\xzw\.gemini\antigravity-ide\brain\3aa1f3ea-473a-4942-8d80-e42854548eb9\app_icon_1781599403269.png"
    dest_ico = r"c:\antigravity\AutoButton\client\public\icon.ico"
    convert_png_to_ico(src_png, dest_ico)

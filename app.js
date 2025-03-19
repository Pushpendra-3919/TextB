const express = require("express");
const multer = require("multer");
const mongoose = require("mongoose");
const cors = require("cors");
const Tesseract = require("tesseract.js");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const { fromPath } = require("pdf2pic");

const app = express();
app.use(cors());
app.use(express.json());

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Connect to MongoDB
mongoose
  .connect("mongodb+srv://pushpendra391924:UR0IyqwNC6vdHEA2@cluster0.jk53z.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0")
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Define schema & model
const fileSchema = new mongoose.Schema({
  filename: String,
  text: String,
});
const File = mongoose.model("File", fileSchema);

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });

// Function to extract text from PDF (for text-based PDFs)
const extractTextFromPDF = async (pdfPath) => {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdfParse(dataBuffer);
    return data.text.trim();
  } catch (error) {
    console.error("Error extracting text from PDF:", error);
    return "";
  }
};

// Function to convert scanned PDFs to images using pdf2pic
const convertPdfToImages = async (pdfPath) => {
  const outputDir = path.dirname(pdfPath);
  const outputPrefix = path.basename(pdfPath, ".pdf");

  const converter = fromPath(pdfPath, {
    density: 300,
    saveFilename: outputPrefix,
    savePath: outputDir,
    format: "png",
    width: 1000,
    height: 1000,
  });

  try {
    const images = await converter.bulk(-1); // Convert all pages
    return images.map((img) => img.path); // Return image paths
  } catch (error) {
    console.error("Error converting PDF to images:", error);
    return [];
  }
};

// File Upload & OCR Processing
app.post("/upload", upload.array("files"), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded." });
    }

    let results = [];

    for (const file of req.files) {
      let extractedText = "";

      if (file.mimetype === "application/pdf") {
        // Try extracting text directly
        extractedText = await extractTextFromPDF(file.path);

        if (!extractedText) {
          // If no text was extracted, treat it as a scanned PDF and use OCR
          const imagePaths = await convertPdfToImages(file.path);

          for (const imagePath of imagePaths) {
            const { data } = await Tesseract.recognize(imagePath, "eng");
            extractedText += data.text.trim() + "\n";
            fs.unlinkSync(imagePath); // Delete temporary images
          }
        }
      } else {
        // Process image files with OCR
        const { data } = await Tesseract.recognize(file.path, "eng");
        extractedText = data.text.trim();
      }

      // Save to database
      const savedFile = new File({ filename: file.originalname, text: extractedText });
      await savedFile.save();

      results.push({ filename: file.originalname, extractedText });
      fs.unlinkSync(file.path); // Delete uploaded file after processing
    }

    res.json({ message: "Files uploaded and processed successfully", results });
  } catch (error) {
    console.error("Upload Error:", error);
    res.status(500).json({ error: "Server error during file upload" });
  }
});

// Fetch Processed Files
app.get("/files", async (req, res) => {
  try {
    const files = await File.find();
    res.json(files);
  } catch (error) {
    console.error("Database Fetch Error:", error);
    res.status(500).json({ error: "Error retrieving files" });
  }
});

// Start Server
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

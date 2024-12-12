const router = require("express").Router();

const Auditors = require("../model/auditors"); // Make sure to adjust the path as needed
const {
  ThermalPrinter,
  PrinterTypes,
  CharacterSet,
  BreakLine,
} = require("node-thermal-printer");
const puppeteer = require("puppeteer");

const browserPromise = puppeteer.launch(); // Launch the browser once

const Setting = require("../model/pagesetting");
async function printImageAsync(imagePath, printincount) {
  const setting = await Setting.findOne();

  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://192.30.30.20/:9100`,
    // characterSet: CharacterSet.SLOVENIA,
    removeSpecialCharacters: false,
    lineCharacter: "=",
    breakLine: BreakLine.WORD,
    options: {
      timeout: 2000,
    },
  });

  try {
    printer.alignCenter();
    // await printer.printImage(`./public/img/image.png`); // Print PNG image
    await printer.printImage(imagePath); // Print PNG image
    await printer.cut();
    for (i = 0; i < printincount; i++) {
      await printer.execute();
    }
    console.log("Image printed successfully.");
  } catch (error) {
    console.error("Error printing image:", error);
  }
}

// Add a new category
router.get("/getall", async (req, res) => {
  try {
    const category = await Auditors.find()
      .populate("Examinername")
      .populate("department")
      .sort({ addDate: -1 })
      .limit(40);

    res.status(201).json(category);
  } catch (error) {
    console.log(error);
    res.status(400).json({ error: error.message });
  }
});

router.get("/getall/:searchSequance", async (req, res) => {
  const searchName = req.params.searchSequance;
  try {
    const auditors = await Auditors.find({
      sequence: searchName,
    })
      .populate("Examinername")
      .populate("department")

      .sort({ updatedAt: -1 })
      // Sort by 'updatedAt' field in descending order
    res.json(auditors);
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post("/new", async (req, res) => {
  try {
    const lastAuditor = await Auditors.findOne().sort({ addDate: -1 });
    const data = req.body;
    if (lastAuditor) {
      data.sequence = lastAuditor.sequence + 1;
    } else {
      data.sequence = 1;
    }
    const category = new Auditors(req.body);
    await category.save();
    const htmlContent = `<!DOCTYPE html>
    <html lang="ar">
      <head>
        <style>
          * {
            font-size: 1.4rem;
            margin: 0px;
            font-family: "Arial";
          }
    
          main {
            padding: 6px;
            width: 560px;
          }
    
          .dashed-line {
            border: none;
            height: 2px;
            /* Set the desired height for the dashed line */
            background-image: repeating-linear-gradient(
              to right,
              black,
              black 8px,
              transparent 8px,
              transparent 16px
            );
          }
    
          .centerdiv {
            display: flex;
            justify-content: center;
            align-items: center;
          }
    
          table,
          th,
          td {
            border: 1px solid black;
            border-collapse: collapse;
          }
    
          table {
            width: 100%;
          }
    
          th,
          td {
            text-align: center;
          }
        </style>
      </head>
    
      <body>
        <main>
          <div style="margin-top: 60px;display: flex;justify-items: center;align-items: center;justify-content: center;">
            <a style="font-size: 10rem;">${data.sequence}</a>
          </div>
    
          <div
            class="centerdiv"
            style="padding-top: 10px; text-align: center; font-size: 1.8rem"
          ></div>
        </main>
      </body>
    </html>
    `;

    const generateImage = async () => {
      const browser = await browserPromise; // Reuse the same browser instance
      const page = await browser.newPage();
      await page.setContent(htmlContent);

      await page.waitForSelector("main"); // Wait for the <main> element to be rendered
      const mainElement = await page.$("main"); // Select the <main> element

      await mainElement.screenshot({
        path: "./image.png",
        fullPage: false, // Capture only the <main> element
        javascriptEnabled: false,
        headless: true,
      });
      console.log("Image generation done");
    };

    await generateImage(); // Generate the image asynchronously
    await printImageAsync("./image.png", 1);

    res.status(201).json(category);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/finish", async (req, res) => {
  try {
    console.log(req.body);
    const category = await Auditors.findById(req.body.id);
    category.state = "مكتمل";
    category.ExaminerProcedureDate = new Date();
    category.ExaminerFinish = true;
    category.Examinername = req.body.userID;
    await category.save();
    res.status(201).json(category);
  } catch (error) {
    console.log(error.message);
    res.status(400).json({ error: error.message });
  }
});

router.post("/cancele", async (req, res) => {
  try {
    const category = await Auditors.findById(req.body.id);
    category.state = "ملغى";
    category.ExaminerProcedureDate = new Date();
    category.ExaminerFinish = true;
    category.Examinername = req.body.userID;
    await category.save();
    res.status(201).json(category);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/addDepartmentToAuditors", async (req, res) => {
  try {
    const category = await Auditors.findById(req.body.auditosID);
    category.department = req.body.departmentID;
    category.ExaminerFinish = true;
    category.state = "مكتمل";
    category.Examinername = req.body.userID;

    await category.save();
    res.status(201).json(category);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/skip", async (req, res) => {
  try {
    const category = await Auditors.findOne({ ExaminerFinish: true })
      .sort({ addDate: -1 })
      .exec();
    category.state = "متخطى";
    category.ExaminerProcedureDate = new Date();
    category.ExaminerFinish = true;

    await category.save();
    res.status(201).json(category);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/share", async (req, res) => {
  try {
    const category = new Auditors(req.body);
    await category.save();
    res.status(201).json(category);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get all categories
router.get("/cancele", async (req, res) => {
  try {
    const categories = await Auditors.find();
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/analysis", async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const thisWeekStart = new Date();
    thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());

    const thisMonthStart = new Date();
    thisMonthStart.setDate(1);

    const todayCount = await Auditors.countDocuments({
      addDate: { $gte: todayStart },
    });
    const thisWeekCount = await Auditors.countDocuments({
      addDate: { $gte: thisWeekStart },
    });
    const thisMonthCount = await Auditors.countDocuments({
      addDate: { $gte: thisMonthStart },
    });
    const allTimeCount = await Auditors.countDocuments({});
    // Counts by state
    const awaitingCount = await Auditors.countDocuments({ state: "انتضار" });
    const completedCount = await Auditors.countDocuments({ state: "مكتمل" });
    const cancelledCount = await Auditors.countDocuments({ state: "ملغى" });

    res.json({
      today: todayCount,
      thisWeek: thisWeekCount,
      thisMonth: thisMonthCount,
      allTime: allTimeCount,
      awaiting: awaitingCount,
      completed: completedCount,
      cancelled: cancelledCount,
    });
  } catch (err) {
    console.error("Error fetching Auditor counts:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
// Get one category by ID
router.get("/getone/:id", async (req, res) => {
  try {
    const category = await Auditors.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.json(category);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Edit one category by ID
router.put("/edit/:id", async (req, res) => {
  try {
    const category = await Auditors.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.json(category);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete one category by ID
router.delete("/delete/:id", async (req, res) => {
  try {
    const category = await Auditors.findByIdAndDelete(req.params.id);
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.json({ message: "Category deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/last-auditor", async (req, res) => {
  try {
    const lastAuditor = await Auditors.findOne().sort({ addDate: -1 }).exec();
    res.json(lastAuditor);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error" });
  }
});

// Route to get the last auditor with state "انتضار" (pending)
router.get("/last-pending-auditor", async (req, res) => {
  try {
    const lastPendingAuditor = await Auditors.findOne({ ExaminerFinish: true })
      .sort({ addDate: -1 })
      .exec();
    res.json(lastPendingAuditor);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error" });
  }
});

module.exports = router;

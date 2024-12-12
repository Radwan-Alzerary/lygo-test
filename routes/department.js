const router = require("express").Router();
const Department = require("../model/Department");
const Category = require("../model/Department");
const Auditors = require("../model/auditors");

const multer = require("multer");
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "./public/img/category");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const extension = file.originalname.split(".").pop();
    cb(null, uniqueSuffix + "." + extension);
  },
});

// Create multer instance for uploading image
const upload = multer({ storage: storage });
// Create a new category
router.post("/", async (req, res) => {
  const bodyData = req.body;
  try {
    const category = new Category(bodyData);
    const savedCategory = await category.save();
    res.status(201).json(savedCategory);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
// Get all categories
router.get("/", async (req, res) => {
  try {
    const categories = await Category.find();
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
router.get("/departments-with-auditor-counts", async (req, res) => {
  try {
    const today = new Date();
    const startOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    const startOfWeek = new Date(
      today.setDate(today.getDate() - today.getDay())
    );
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const result = await Department.aggregate([
      {
        $lookup: {
          from: "auditors",
          localField: "_id",
          foreignField: "department",
          as: "auditors",
        },
      },
      {
        $unwind: {
          path: "$auditors",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $group: {
          _id: "$_id",
          departmentName: { $first: "$name" },
          auditorsCount: { $sum: { $cond: [{ $ifNull: ["$auditors._id", false] }, 1, 0] } },
          auditorsCountToday: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ifNull: ["$auditors._id", false] },
                    { $gte: ["$auditors.addDate", startOfDay] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          auditorsCountWeek: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ifNull: ["$auditors._id", false] },
                    { $gte: ["$auditors.addDate", startOfWeek] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          auditorsCountMonth: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ifNull: ["$auditors._id", false] },
                    { $gte: ["$auditors.addDate", startOfMonth] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          departmentId: "$_id",
          departmentName: 1,
          auditorsCount: 1,
          auditorsCountToday: 1,
          auditorsCountWeek: 1,
          auditorsCountMonth: 1,
        },
      },
    ]);
console.log(result)
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Get a specific category by ID
router.get("/:id", async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.json(category);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Update a category by ID
router.put("/:id", upload.single("image"), async (req, res) => {
  const bodyData = req.body;
  if (req.file) {
    const imagePath = req.file ? "/img/category/" + req.file.filename : null;
    bodyData.image = imagePath;
  }

  try {
    const updatedCategory = await Category.findByIdAndUpdate(
      req.params.id,
      bodyData,
      { new: true }
    );
    if (!updatedCategory) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.json(updatedCategory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/active/:id", async (req, res) => {
  try {
    const updatedCategory = await Category.findByIdAndUpdate(
      req.params.id,
      { active: req.body.active },
      { new: true }
    );
    if (!updatedCategory) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.json(updatedCategory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a category by ID
router.delete("/:id", async (req, res) => {
  try {
    const deletedCategory = await Category.findByIdAndDelete(req.params.id);
    if (!deletedCategory) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.json(deletedCategory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

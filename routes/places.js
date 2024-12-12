const Place = require("../model/places");
const router = require("express").Router();
const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");

// Create a new place
router.post("/places", async (req, res) => {
  try {
    const place = new Place(req.body);
    await place.save();
    res.status(201).send(place);
  } catch (error) {
    res.status(400).send(error);
  }
});
// Import CSV data into the database via GET route
router.get("/import-places", async (req, res) => {
  try {
    // Read the JSON file
    const data = fs.readFileSync(path.join(__dirname, "places.json"), "utf-8");

    // Parse the JSON data
    const jsonData = JSON.parse(data);

    // Prepare data for insertion, converting lat/lng to GeoJSON format
    const places = jsonData.map((row) => ({
      name: row.Name,
      location: {
        type: "Point",
        coordinates: [Number(row.Lng), Number(row.Lat)], // [longitude, latitude]
      },
    }));

    // Insert data into MongoDB
    await Place.insertMany(places);
    res.status(200).send("JSON data imported successfully");
  } catch (error) {
    res.status(500).send("Error importing data: " + error.message);
  }
});

// Read all places
router.get("/places", async (req, res) => {
  try {
    const places = await Place.find({}).limit(10);
    res.status(200).send(places);
  } catch (error) {
    res.status(500).send(error);
  }
});

// Read a single place by ID
router.get("/places/:id", async (req, res) => {
  try {
    const place = await Place.findById(req.params.id);
    if (!place) {
      return res.status(404).send();
    }
    res.status(200).send(place);
  } catch (error) {
    res.status(500).send(error);
  }
});

router.get("/nearest-place", async (req, res) => {
    const { lat, lng } = req.query;
    console.log(lat, lng);
  
    if (!lat || !lng) {
      return res.status(400).send("Latitude and Longitude are required");
    }
  
    try {
      // Find the nearest place using geospatial query
      const place = await Place.findOne({
        location: {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: [Number(lng), Number(lat)],
            },
            $maxDistance: 5000, // Adjust this value according to your needs
          },
        },
      });
  
      if (!place) {
        return res.status(404).send("No place found near the given coordinates");
      }
  
      res.status(200).send({ name: place.name });
    } catch (error) {
      res.status(500).send("Error finding the nearest place: " + error.message);
    }
  });
  
// Find places by name with a limit of 10
router.get("/search/name", async (req, res) => {
  try {
    const name = req.query.query;
    console.log("Received name:", name); // Log the query parameter
    const places = await Place.find({ name: new RegExp(name, "i") }).limit(10);
    console.log(places);
    res.status(200).send(places);
  } catch (error) {
    console.error("Error fetching places:", error);
    res.status(500).send({ error: "Internal Server Error" });
  }
});

// Update a place by ID
router.patch("/places/:id", async (req, res) => {
  const updates = Object.keys(req.body);
  const allowedUpdates = [
    "name",
    "anotherName",
    "cuntery",
    "goverment",
    "priority",
    "bookedTime",
    "lat",
    "lng",
  ];
  const isValidOperation = updates.every((update) =>
    allowedUpdates.includes(update)
  );

  if (!isValidOperation) {
    return res.status(400).send({ error: "Invalid updates!" });
  }

  try {
    const place = await Place.findById(req.params.id);

    if (!place) {
      return res.status(404).send();
    }

    updates.forEach((update) => (place[update] = req.body[update]));
    await place.save();
    res.status(200).send(place);
  } catch (error) {
    res.status(400).send(error);
  }
});

// Delete a place by ID
router.delete("/places/:id", async (req, res) => {
  try {
    const place = await Place.findByIdAndDelete(req.params.id);

    if (!place) {
      return res.status(404).send();
    }

    res.status(200).send(place);
  } catch (error) {
    res.status(500).send(error);
  }
});
module.exports = router;

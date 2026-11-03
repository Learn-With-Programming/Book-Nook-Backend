import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import jwt from "jsonwebtoken";
import "dotenv/config";

const app = express();
const port = process.env.PORT || 5000;

const client = new MongoClient(process.env.MONGODB_URI);

const booksCollection = client.db("Book-Nook").collection("books");
const borrowsCollection = client.db("Book-Nook").collection("borrows");

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send({ message: "BookNook server is running" });
});

const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).send({ message: "invalid or expired token" });
  }
};

// ---------- books ----------

app.get("/books", async (req, res) => {
  const query = {};
  if (req.query.email) {
    query.userEmail = req.query.email;
  }

  let cursor = booksCollection.find(query).sort({ addedDate: -1 });
  if (req.query.limit) {
    cursor = cursor.limit(parseInt(req.query.limit));
  }

  res.send(await cursor.toArray());
});

app.get("/books/:id", async (req, res) => {
  const id = req.params.id;
  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "invalid book id" });
  }

  const book = await booksCollection.findOne({ _id: new ObjectId(id) });
  if (!book) {
    return res.status(404).send({ message: "book not found" });
  }

  res.send(book);
});
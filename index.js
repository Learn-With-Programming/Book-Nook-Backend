import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import jwt from "jsonwebtoken";
import "dotenv/config";

const app = express();
const port = process.env.PORT || 5000;

let cachedClient = global.mongoClient;
let cachedDb = global.mongoDb;

async function connectToMongoDB() {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
  });
  await client.connect();
  const db = client.db("Book-Nook");

  global.mongoClient = client;
  global.mongoDb = db;

  console.log("You successfully connected to MongoDB!");
  return { client, db };
}

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
  const { db } = await connectToMongoDB(); // ২. প্রতিটি রুটে ডাটাবেস কল করা
  const booksCollection = db.collection("books");

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
  const { db } = await connectToMongoDB();
  const booksCollection = db.collection("books");

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

app.post("/books", verifyJWT, async (req, res) => {
  const { db } = await connectToMongoDB();
  const booksCollection = db.collection("books");

  const book = req.body;
  book.addedDate = new Date();
  book.userName = req.user.name;
  book.userEmail = req.user.email;

  const result = await booksCollection.insertOne(book);
  res.send(result);
});

app.patch("/books/:id", verifyJWT, async (req, res) => {
  const { db } = await connectToMongoDB();
  const booksCollection = db.collection("books");

  const id = req.params.id;
  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "invalid book id" });
  }

  const updatedBook = {
    $set: {
      title: req.body.title,
      author: req.body.author,
      category: req.body.category,
      image: req.body.image,
      description: req.body.description,
      copies: parseInt(req.body.copies),
    },
  };

  const result = await booksCollection.updateOne(
    { _id: new ObjectId(id) },
    updatedBook,
  );
  if (result.matchedCount == 0) {
    return res.status(404).send({ message: "book not found" });
  }

  res.send(result);
});

app.delete("/books/:id", verifyJWT, async (req, res) => {
  const { db } = await connectToMongoDB();
  const booksCollection = db.collection("books");

  const id = req.params.id;
  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "invalid book id" });
  }

  const result = await booksCollection.deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount == 0) {
    return res.status(404).send({ message: "book not found" });
  }

  res.send(result);
});

// ---------- borrows ----------

app.post("/borrows", verifyJWT, async (req, res) => {
  const { db } = await connectToMongoDB();
  const booksCollection = db.collection("books");
  const borrowsCollection = db.collection("borrows");

  const bookId = req.body.bookId;
  if (!ObjectId.isValid(bookId)) {
    return res.status(400).send({ message: "invalid book id" });
  }

  const book = await booksCollection.findOne({ _id: new ObjectId(bookId) });
  if (!book) {
    return res.status(404).send({ message: "book not found" });
  }

  if (book.copies <= 0) {
    return res
      .status(409)
      .send({ message: "this book is not available right now" });
  }

  const alreadyBorrowed = await borrowsCollection.findOne({
    bookId: bookId,
    userEmail: req.user.email,
  });
  if (alreadyBorrowed) {
    return res.status(409).send({
      message: "you already borrowed this book, please return it first",
    });
  }

  const borrowDate = new Date();
  let returnDate = new Date(borrowDate);
  returnDate.setDate(returnDate.getDate() + 7);
  if (req.body.returnDate) {
    returnDate = new Date(req.body.returnDate);
  }

  const borrowData = {
    bookId: bookId,
    bookTitle: book.title,
    bookImage: book.image,
    userName: req.user.name,
    userEmail: req.user.email,
    borrowDate: borrowDate.toISOString(),
    returnDate: returnDate.toISOString(),
  };

  const result = await borrowsCollection.insertOne(borrowData);

  await booksCollection.updateOne(
    { _id: new ObjectId(bookId) },
    { $inc: { copies: -1 } },
  );

  res.send(result);
});

app.get("/borrows", verifyJWT, async (req, res) => {
  const { db } = await connectToMongoDB();
  const borrowsCollection = db.collection("borrows");

  const borrowsList = await borrowsCollection
    .find({ userEmail: req.user.email })
    .sort({ borrowDate: -1 })
    .toArray();
  res.send(borrowsList);
});

app.delete("/borrows/:id", verifyJWT, async (req, res) => {
  const { db } = await connectToMongoDB();
  const booksCollection = db.collection("books");
  const borrowsCollection = db.collection("borrows");

  const id = req.params.id;
  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "invalid borrow id" });
  }

  const borrow = await borrowsCollection.findOne({ _id: new ObjectId(id) });
  if (!borrow) {
    return res.status(404).send({ message: "borrow not found" });
  }

  if (borrow.userEmail !== req.user.email) {
    return res.status(403).send({ message: "forbidden access" });
  }

  const result = await borrowsCollection.deleteOne({ _id: new ObjectId(id) });

  await booksCollection.updateOne(
    { _id: new ObjectId(borrow.bookId) },
    { $inc: { copies: 1 } },
  );

  res.send(result);
});

app.use((req, res) => {
  res.status(404).send({ message: "route not found" });
});

if (process.env.NODE_ENV !== "production") {
  connectToMongoDB().then(() => {
    app.listen(port, () => {
      console.log(`BookNook server is running on port ${port}`);
    });
  });
}

export default app;

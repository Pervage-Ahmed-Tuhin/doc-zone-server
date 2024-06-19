const express = require('express')
const app = express()
require('dotenv').config()
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')

const port = process.env.PORT || 5000

// middleware
const corsOptions = {
    origin: ['http://localhost:5173', 'http://localhost:5174'],
    credentials: true,
    optionSuccessStatus: 200,
}
app.use(cors(corsOptions))

app.use(express.json())
app.use(cookieParser())

// Verify Token Middleware
const verifyToken = async (req, res, next) => {

    console.log('inside the verify token ', req.headers);
    if (!req.headers.authorization) {
        return res.status(401).send({ message: 'forbidden access' });
    }

    const token = req.headers.authorization.split(' ')[1];
    if (!token) {
        return res.status(401).send({ message: 'forbidden access' });
    }

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ message: 'forbidden access' })
        }
        req.decoded = decoded;
        next();
    })
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.iz3dvmk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
})

async function run() {
    try {
        // auth related api
        app.post('/jwt', async (req, res) => {
            const user = req.body
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
                expiresIn: '365d',
            })
            res.send({ token })
        })
        // Logout
        app.get('/logout', async (req, res) => {
            try {
                res
                    .clearCookie('token', {
                        maxAge: 0,
                        secure: process.env.NODE_ENV === 'production',
                        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
                    })
                    .send({ success: true })
                console.log('Logout successful')
            } catch (err) {
                res.status(500).send(err)
            }
        })

        const medicineCollection = client.db('medzone').collection('medicine');
        const medicineCategory = client.db('medzone').collection('category');
        const usersCollection = client.db('medzone').collection('users')
        const cartCollection = client.db('medzone').collection('cart')

        //This is the api for the banner and other components

        app.get('/medicine', async (req, res) => {
            try {
                const featuredMedicines = await medicineCollection.find().toArray();
                res.send(featuredMedicines);
            } catch (error) {
                console.error("Error fetching featured medicines:", error);
                res.status(500).json({ error: "Internal server error" });
            }
        });

        // getting individual category

        app.get('/category', async (req, res) => {

            try {
                const result = await medicineCategory.find().toArray();
                res.send(result);
            } catch (error) {
                console.error("Error fetching featured medicines:", error);
                res.status(500).json({ error: "Internal server error" });
            }

        })

        //Save user in data base
        app.put('/user', async (req, res) => {
            const user = req.body
            const query = { email: user?.email }
            // check if user already exists in db
            const isExist = await usersCollection.findOne(query)
            if (isExist) {
                if (user.status === 'Requested') {
                    // if existing user try to change his role
                    const result = await usersCollection.updateOne(query, {
                        $set: { status: user?.status },
                    })
                    return res.send(result)
                } else {
                    // if existing user login again
                    return res.send(isExist)
                }
            }

            // save user for the first time
            const options = { upsert: true }
            const updateDoc = {
                $set: {
                    ...user,
                    timestamp: Date.now(),
                },
            }
            const result = await usersCollection.updateOne(query, updateDoc, options)
            res.send(result)
        })

        //get a user info from the database

        app.get('/user/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            const result = await usersCollection.findOne({ email })
            res.send(result);
        })

        //getting discounted data
        app.get('/discounted', async (req, res) => {
            try {
                const discountedProducts = await medicineCollection.find({ discountStatus: true }).toArray();

                // Sending the filtered products as JSON response
                res.json(discountedProducts);
            } catch (error) {
                console.error("Error fetching discounted products:", error);
                res.status(500).json({ error: "Internal server error" });
            }
        });

        //Getting all the user info for admin only

        // get all users data from db
        app.get('/users', async (req, res) => {
            const result = await usersCollection.find().toArray()
            res.send(result)
        })


        //Storing cart information to the database

        app.post('/cartInformation', verifyToken, async (req, res) => {

            const cartItem = req.body;
            const result = await cartCollection.insertOne(cartItem);
            res.send(result);

        })

        //updating the quantity of a single item in the cart 

        app.patch('/cartInformation/:id', verifyToken, async (req, res) => {
            try {
                const itemId = req.params.id; // Get the id of the cart item to update
                const { quantity } = req.body; // Extract the quantity from the request body

                // Check if quantity is a valid number
                if (typeof quantity !== 'number' || quantity <= 0) {
                    return res.status(400).json({ error: 'Quantity must be a positive number.' });
                }

                // Update the cart item in the database
                const result = await cartCollection.updateOne(
                    { _id: new ObjectId(itemId) }, // Find the cart item by its ID
                    { $set: { quantity: quantity } } // Update the quantity field
                );

                res.send(result);
            } catch (error) {
                console.error('Error updating cart item:', error);
                res.status(500).json({ error: 'Internal server error.' });
            }
        });

        //getting cart information using email for specific user

        app.get('/cartInformation/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            const decodedEmail = req.decoded.email; // Get email from decoded token

            if (email !== decodedEmail) {
                return res.status(403).send({ message: 'unauthorized access' });
            }

            try {
                const result = await cartCollection.find({ email }).toArray(); // Changed findOne to find to return array of cart items
                res.send(result);
            } catch (error) {
                console.error('Error fetching cart information:', error);
                res.status(500).send({ message: 'Internal server error' });
            }
        });


        // Getting individual element from a certain category

        app.get('/UniqueCategory/:category', async (req, res) => {
            const category = req.params.category;

            try {

                const results = await medicineCollection.find({
                    category: category
                }).toArray();

                if (results.length === 0) {
                    res.status(404).send('No documents found');
                } else {
                    res.json(results);
                }
            } catch (error) {
                console.error('Error finding documents:', error);
                res.status(500).send('Internal Server Error');
            }
        })

        app.get('/allMedicines', async (req, res) => {
            const page = parseInt(req.query.page);
            const size = parseInt(req.query.size);

            const result = await medicineCollection.find()
                .skip(page * size)
                .limit(size)
                .toArray();
            res.send(result);
        })

        app.get('/productCount', async (req, res) => {
            const count = await medicineCollection.estimatedDocumentCount();
            res.send({ count });
        })


        // Send a ping to confirm a successful connection
        await client.db('admin').command({ ping: 1 })
        console.log(
            'Pinged your deployment. You successfully connected to MongoDB!'
        )
    } finally {
        // Ensures that the client will close when you finish/error
    }
}
run().catch(console.dir)

app.get('/', (req, res) => {
    res.send('Hello from multi vendor server')
})

app.listen(port, () => {
    console.log(`multi vendor is running on port ${port}`)
})

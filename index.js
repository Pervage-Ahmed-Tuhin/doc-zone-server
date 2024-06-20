const express = require('express')
const app = express()
require('dotenv').config()
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const port = process.env.PORT || 5000

// middleware
const corsOptions = {
    origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'],
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
        const bookingsCollection = client.db('medzone').collection('booking')



        const verifyAdmin = async (req, res, next) => {
            console.log('hello')
            const user = req.decoded
            const query = { email: user?.email }
            const result = await usersCollection.findOne(query)
            console.log(result?.role)
            if (!result || result?.role !== 'admin')
                return res.status(401).send({ message: 'unauthorized access!!' })

            next()
        }


        // verify seller middleware
        const verifySeller = async (req, res, next) => {
            console.log('hello')
            const user = req.decoded
            const query = { email: user?.email }
            const result = await usersCollection.findOne(query)
            console.log(result?.role)
            if (!result || result?.role !== 'seller') {
                return res.status(401).send({ message: 'unauthorized access!!' })
            }

            next()
        }


        //update a users role by admin route

        app.patch('/users/:email', verifyToken, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const { role } = req.body;


            const validRoles = ['user', 'seller', 'admin'];
            if (!validRoles.includes(role)) {
                return res.status(400).send({ message: 'Invalid role' });
            }

            try {
                const result = await usersCollection.updateOne(
                    { email: email },
                    { $set: { role: role } }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).send({ message: 'User not found' });
                }

                res.send({ message: 'Role updated successfully' });
            } catch (error) {
                console.error('Error updating user role:', error);
                res.status(500).send({ message: 'Internal server error' });
            }
        });






        //payment intent

        app.post('/create-payment-intent', verifyToken, async (req, res) => {
            const price = req.body.price
            const priceInCent = parseFloat(price) * 100
            if (!price || priceInCent < 1) return
            // generate clientSecret
            const { client_secret } = await stripe.paymentIntents.create({
                amount: priceInCent,
                currency: 'usd',
                // In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
                automatic_payment_methods: {
                    enabled: true,
                },
            })
            // send client secret as response
            res.send({ clientSecret: client_secret })
        })

        //save booking data to the database

        app.post('/booking', verifyToken, async (req, res) => {
            try {
                const bookingData = req.body;
                const result = await bookingsCollection.insertOne(bookingData);
                // Send response back to the client
                res.send(result);
            } catch (error) {
                console.error('Error saving booking:', error);
                res.status(500).json({ success: false, message: 'Internal Server Error' });
            }
        });




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

        app.post('/category', async (req, res) => {
            try {
                const newCategory = req.body;
                console.log(newCategory);
                const result = await medicineCategory.insertOne(newCategory);
                res.json(result);
            } catch (error) {
                console.error(error);
                res.status(500).json({ message: 'Internal server error' });
            }
        })

        app.delete('/category/:categoryId', async (req, res) => {
            const id = req.params.categoryId;
            const query = { _id: new ObjectId(id) };
            const result = await medicineCategory.deleteOne(query);
            res.send(result);
        })



        // Update a category
        app.put('/category/:categoryId', verifyToken, verifyAdmin, async (req, res) => {
            const { categoryId } = req.params;
            const { category, image_url } = req.body;

            const filter = { _id: new ObjectId(categoryId) };
            const update = {
                $set: {
                    category,
                    image_url
                }
            };

            try {
                const updatedCategory = await medicineCategory.findOneAndUpdate(filter, update, { new: true });

                if (!updatedCategory) {
                    return res.status(404).json({ error: 'Category not found' });
                }

                res.json(updatedCategory);
            } catch (error) {
                console.error('Error updating category:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        //getting booking collection based on user email

        app.get('/bookingsCollection/:email', async (req, res) => {
            const email = req.params.email;
            console.log(`Request received for email: ${email}`); // Debug log

            try {
                const result = await bookingsCollection.find({ email }).toArray();
                console.log(`Database result: ${JSON.stringify(result)}`); // Debug log
                res.send(result);
            } catch (error) {
                console.error('Error fetching cart information:', error);
                res.status(500).send({ message: 'Internal server error' });
            }
        });


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
        app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
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

        //delete a single cart item from the data base

        app.delete('/cartInformation/:id', verifyToken, async (req, res) => {
            const itemId = req.params.id;
            try {
                const result = await cartCollection.deleteOne({ _id: new ObjectId(itemId) });
                res.send(result);
            } catch (error) {
                res.status(500).send({ success: false, message: 'An error occurred while deleting the item', error });
            }
        });

        //deleting all the cart information from the mongodb

        app.delete("/deleteAllCartInformation", verifyToken, async (req, res) => {
            try {
                const result = await cartCollection.deleteMany({});
                res.send(result);
            } catch (error) {
                res.status(500).send({ success: false, message: 'An error occurred while deleting all items', error });
            }
        })


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

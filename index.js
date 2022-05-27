const express = require("express");
const logger = require("morgan");
const mongoose = require("mongoose");
const axios = require("axios").default;
const midtransClient = require("midtrans-client");
const amqp = require("amqplib/callback_api");

const app = express();

const snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: "SB-Mid-server-Qa_Kayv1_ARJSO4Y-KHSHO59",
});

app.use(express.json());
app.use(logger("common"));

const CONN_URL =
  "amqps://nlekkhuz:8uhhFH6MhUL0LIZA3ijM6y1QMe7k3EbA@albatross.rmq.cloudamqp.com/nlekkhuz";
let ch = null;
amqp.connect(CONN_URL, (err, conn) => {
  conn.createChannel((err, channel) => {
    ch = channel;
  });
});

mongoose.connect(
  "mongodb+srv://doan:akucintalaw@payment-service.fkm0zwa.mongodb.net/?retryWrites=true&w=majority"
);
const CartPayment = mongoose.model("CartPayment", {
  cart_id: String,
  token: String,
});

app.post("/snap-token", (req, res) => {
  const {
    cart_id,
    amount,
    customer_details: { first_name, last_name, email, phone },
  } = req.body;

  const params = {
    transaction_details: {
      order_id: Math.random()
        .toString(36)
        .replace(/[^a-z]+/g, "")
        .substr(0, 5),
      gross_amount: amount,
    },
    customer_details: {
      first_name,
      last_name,
      email,
      phone,
    },
  };

  snap.createTransaction(params).then((transaction) => {
    const cartPayment = new CartPayment({ cart_id, token: transaction.token });
    cartPayment.save();

    axios
      .post(
        "https://logs-01.loggly.com/inputs/c33818a3-eb2d-4b4f-8d89-6dae5e3993c1/tag/http",
        {
          endpoint:
            "https://payment-service-law.herokuapp.com/payment/snap-token",
          cart_id,
          token: transaction.token,
          service: "PAYMENT_SERVICE",
        }
      )
      .catch((err) => console.error(err));

    res.json({
      token: transaction.token,
    });
  });
});

app.post("/status-update", async (req, res) => {
  const { transaction_id, transaction_status, fraud_status } = req.body;

  CartPayment.findOneAndDelete(
    { token: transaction_id },
    (err, cartPayment) => {
      if (!err && cartPayment) {
        const cartId = cartPayment.cart_id;
        ch.sendToQueue(
          "payment_status_update",
          Buffer.from(`${cartId}:SUCCESS`)
        );

        axios
          .post(
            "https://logs-01.loggly.com/inputs/c33818a3-eb2d-4b4f-8d89-6dae5e3993c1/tag/http",
            {
              endpoint:
                "https://payment-service-law.herokuapp.com/payment/status-update",
              cart_id: cartId,
              token: transaction_id,
              service: "PAYMENT_SERVICE",
            }
          )
          .catch((err) => console.error(err));
      }
    }
  );

  res.sendStatus(200);
});

app.listen(process.env.PORT, () => {
  console.log(`Payment Service listening on port ${process.env.PORT}`);
});

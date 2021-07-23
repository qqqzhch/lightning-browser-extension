import axios from "axios";
import PubSub from "pubsub-js";
import { parsePaymentRequest } from "invoices";

import utils from "../../../../common/lib/utils";
import state from "../../state";
import { bech32Decode } from "../../../../common/utils/helpers";

async function lnurl(message) {
  try {
    const lnurlDecoded = bech32Decode(message.args.lnurlEncoded);
    const url = new URL(lnurlDecoded);
    let lnurlType = url.searchParams.get("tag");
    let lnurlDetails;

    if (lnurlType === "login") {
      lnurlDetails = {
        k1: url.searchParams.get("k1"),
        action: url.searchParams.get("action"),
      };
    } else {
      const res = await axios.get(lnurlDecoded);
      lnurlDetails = res.data;
      lnurlType = res.data.tag;
    }

    switch (lnurlType) {
      case "channelRequest":
        console.log("lnurl-channel");
        return;
      case "login":
        console.log("lnurl-auth");
        console.log(lnurlDetails);
        return;
      case "payRequest":
        return payWithPrompt(message, lnurlDetails);
      case "withdrawRequest":
        console.log("lnurl-withdraw");
        return;
      default:
        return;
    }
  } catch (e) {
    console.log(e.message);
  }
}

async function payWithPrompt(message, lnurlDetails) {
  const connector = state.getState().getConnector();
  const { data } = await utils.openPrompt({
    ...message,
    type: "lnurlPay",
    args: { ...message.args, lnurlDetails },
  });
  const { confirmed, paymentRequest, successAction } = data;
  if (confirmed && paymentRequest) {
    const paymentRequestDetails = parsePaymentRequest({
      request: paymentRequest,
    });

    try {
      const response = await connector.sendPayment({
        paymentRequest,
      });
      publishPaymentNotification(message, paymentRequestDetails, response);

      // Once payment is fulfilled LN WALLET executes a non-null successAction
      // LN WALLET should also store successAction data on the transaction record
      if (successAction) {
        switch (successAction.tag) {
          // TODO:
          // For url, the wallet should give the user a popup which displays description, url, and a 'open' button to open the url in a new browser tab
          case "url":
            break;
          // For message, a toaster or popup is sufficient
          case "message":
            utils.notify({
              message: successAction.message,
            });
            break;
          case "aes":
            // TODO:
            // For aes, LN WALLET must attempt to decrypt a ciphertext with payment preimage
            break;
          default:
            break;
        }
      }

      return response;
    } catch (e) {
      console.log(e.message);
    }
  }
}

function publishPaymentNotification(message, paymentRequestDetails, response) {
  let status = "success"; // default. let's hope for success
  if (response.data.payment_error) {
    status = "failed";
  }
  PubSub.publish(`ln.sendPayment.${status}`, {
    response,
    paymentRequestDetails,
    origin: message.origin,
  });
}

export default lnurl;
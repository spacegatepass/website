const walletlink = require('walletlink');

const apiHost = 'https://api.spacegatepass.com';
const network = 'rinkeby';
const infuraId = 'e269bc0a173a42e99d4fdf28e5fc8ed3';
const providers = {
    mainnet: 'https://mainnet.infura.io/v3/e269bc0a173a42e99d4fdf28e5fc8ed3',
    ropsten: 'https://ropsten.infura.io/v3/e269bc0a173a42e99d4fdf28e5fc8ed3',
    rinkeby: 'https://rinkeby.infura.io/v3/e269bc0a173a42e99d4fdf28e5fc8ed3'
};
const chainIds = {
    mainnet: '0x1',
    ropsten: '0x3',
    rinkeby: '0x4'
};
const etherscan = {
    mainnet: 'https://etherscan.io',
    ropsten: 'https://ropsten.etherscan.io',
    rinkeby: 'https://rinkeby.etherscan.io'
};
const contractAddress = {
    mainnet: '',
    ropsten: '',
    rinkeby: '0x9DFfF7484fbcFeD5A5B380362DD445578d774735'
};
const Web3Modal = window.Web3Modal.default;
const WalletConnectProvider = window.WalletConnectProvider.default;
const WalletLink = walletlink.WalletLink;

const EthersProvider = new ethers.providers.JsonRpcProvider(providers[network]);

let ReadingContract;
let EthersSigner;
let Web3Provider;
let web3Modal;
let maxMintAmount = 0;
let connectedWallet;
let allowlistSignature;
let isAllowlistSale;
let isPublicSale;
let claimedAmount = 0;

const getMaxMintAmountForAddress = async function(address) {
    const response = await fetch(`${apiHost}/${address}/amount`);
    const responseBody = await response.text();

    return parseInt(responseBody);
};

const getSignatureForAllowlist = async function(address, amount) {
    const response = await fetch(`${apiHost}/signature/${address}/${amount}`);

    if (response.status !== 200) {
        throw new Error('Address not part of allowlist');
    }

    return await response.json();
};

const parseError = function (error) {
    if (typeof error === 'string') {
        return error;
    }

    if (typeof error === 'object') {
        if (error.message.indexOf('MetaMask Tx Signature: ') !== -1) {
            return error.message;
        }

        const parsedError = JSON.stringify(error);
        return parsedError === '{}' ? error.message : parsedError;
    }
};

const formatWalletAddress = function (walletAddress) {
    return walletAddress.slice(0, 4) + '...' + walletAddress.slice(-4);
};

window.addEventListener('load', async function() {
    const disclaimerModal = document.getElementById('disclaimerModal');
    const modal = bootstrap.Modal.getOrCreateInstance(disclaimerModal);

    modal.show();

    EthersProvider.pollingInterval = 1000 * 240; // 4min
    ReadingContract = new ethers.Contract(contractAddress[network], await (await fetch('abi_'+network+'.json')).json(), EthersProvider);

    refresh();

    web3Modal = new Web3Modal({
        cacheProvider: false,
        providerOptions: {
            walletconnect: {
                package: WalletConnectProvider,
                options: {
                    infuraId: infuraId,
                }
            },
            walletlink: {
                package: WalletLink, // Required
                options: {
                    appName: "Spacegatepass", // Required
                    infuraId: infuraId, // Required unless you provide a JSON RPC url; see `rpc` below
                    rpc: "", // Optional if `infuraId` is provided; otherwise it's required
                    chainId: 1, // Optional. It defaults to 1 if not provided
                    appLogoUrl: null, // Optional. Application logo image URL. favicon is used if unspecified
                    darkMode: false // Optional. Use dark theme, defaults to false
                }
            }
        },
        disableInjectedProvider: false
    });

    const onConnect = async function () {
        try {
            Web3Provider = await web3Modal.connect();

            if (Web3Provider.chainId !== chainIds[network]) {
                throw new Error('Wrong network selected, please switch to ' + network);
            }

            EthersSigner = (new ethers.providers.Web3Provider(Web3Provider)).getSigner();

            connectedWallet = ethers.utils.getAddress(Web3Provider.selectedAddress);
            this.innerText = formatWalletAddress(connectedWallet);

            claimedAmount = (await ReadingContract.hasClaimed(connectedWallet)).toNumber();

            if (!isPublicSale && isAllowlistSale) {
                try {
                    maxMintAmount = await getMaxMintAmountForAddress(connectedWallet);
                    allowlistSignature = await getSignatureForAllowlist(connectedWallet, maxMintAmount);

                    document.getElementById('mint-button').disabled = false;
                } catch (error) {
                    // not part of allowlist
                    console.error(error);
                    document.getElementById('modal-error-reason').innerText = 'Sorry, you are not on the Allowlist. Public mint begins at 10am EST on 3/11.';
                    document.getElementById('modal-failure-button').click();
                    return;
                }

                if (claimedAmount === maxMintAmount) {
                    document.getElementById('mint-amount-container').style.display = 'none';
                    document.getElementById('mint-button-container').style.display = 'none';
                    document.getElementById('mint-finished-allowlist').style.display = 'block';
                    return;
                }
            }

            if (isPublicSale) {
                document.getElementById('mint-button').disabled = false;
            }
        } catch (error) {
            console.error(error);
            document.getElementById('modal-error-reason').innerText = parseError(error);
            document.getElementById('modal-failure-button').click();
            return;
        }

        Web3Provider.on('accountsChanged', (accounts) => {
            console.debug('Account changed', accounts);
            location.reload();
        });

        Web3Provider.on('chainChanged', (chainId) => {
            console.debug('Chain changed', chainId);
            location.reload();
        });
    };

    for (const connectButton of document.getElementsByClassName('connect-button')) {
        connectButton.addEventListener('click', onConnect);
    }

    document.getElementById('mint-button').addEventListener('click', async function () {
        try {
            if (isAllowlistSale && !isPublicSale) {
                await allowlistMint();
            }

            if (isPublicSale) {
                await publicMint();
            }
        } catch (error) {
            console.error(error);
            document.getElementById('modal-error-reason').innerText = parseError(error);
            document.getElementById('modal-failure-button').click();
        }
    });
});

const allowlistMint = async function() {
    if (EthersSigner === undefined) {
        throw new Error('Not connected');
    }

    const mintAmount = 1;

    const Contract = ReadingContract.connect(EthersSigner);

    const walletBalance = await EthersSigner.getBalance();
    const mintValue = ethers.utils.parseEther('0.2').mul(mintAmount);

    if (mintValue.gte(walletBalance)) {
        throw new Error(`Not enough funds to mint ${mintAmount} for ${ethers.utils.formatEther(mintValue)}`);
    }

    const mintTx = await Contract.claim(
        connectedWallet,
        maxMintAmount,
        mintAmount,
        allowlistSignature,
        {
            value: mintValue
        }
    );

    document.getElementById('modal-success-link').href = `${etherscan[network]}/tx/${mintTx.hash}`;
    document.getElementById('modal-success-button').click();

    const receiptCall = mintTx.wait(1);

    receiptCall.catch(function (error) {
        console.error(error);
        document.getElementById('modal-error-reason').innerText = parseError(error);
        document.getElementById('modal-failure-button').click();
    });

    receiptCall.then(async function (receipt) {
        console.debug('Mint successful', receipt);
    });
};

const publicMint = async function() {
    if (EthersSigner === undefined) {
        throw new Error('Not connected');
    }

    const mintAmount = 1;

    const Contract = ReadingContract.connect(EthersSigner);

    const walletBalance = await EthersSigner.getBalance();
    const mintValue = ethers.utils.parseEther('0.2').mul(mintAmount);

    if (mintValue.gte(walletBalance)) {
        throw new Error(`Not enough funds to mint ${mintAmount} for ${ethers.utils.formatEther(mintValue)}`);
    }

    const mintTx = await Contract.publicMint(
        mintAmount,
        {
            value: mintValue
        }
    );

    document.getElementById('modal-success-link').href = `${etherscan[network]}/tx/${mintTx.hash}`;
    document.getElementById('modal-success-button').click();

    const receiptCall = mintTx.wait(1);

    receiptCall.catch(function (error) {
        console.error(error);
        document.getElementById('modal-error-reason').innerText = parseError(error);
        document.getElementById('modal-failure-button').click();
    });

    receiptCall.then(async function (receipt) {
        console.debug('Mint successful', receipt);
    });
};

const refresh = async function() {
    isAllowlistSale = await ReadingContract.allowlistIsOpen();
    isPublicSale = await ReadingContract.publicSaleIsOpen();

    const currentSupply = await ReadingContract.currentSupply();

    document.getElementById('remaining-supply').innerText = currentSupply.toString();

    const remainingSupply = await ReadingContract.maxSupply() - currentSupply;

    if (remainingSupply <= 0) {
        document.getElementById('mint-button').style.display = 'none';
    }
};

